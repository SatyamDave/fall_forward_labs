// The door orders must pass through to reach the broker (issue #35). This is a separate code
// path from the agent's reasoning loop: it is never registered as an SDK tool (agent/CLAUDE.md,
// ADR-0040 §3), and agent/tests/broker/no-decider-import.test.ts proves nothing under
// agent/src/decider/ can import this directory. It only ever executes an order qc-bridge has
// already approved: verify the v1.1 approval stamp against the hello public key, check the
// payload matches the order field-by-field, reject anything expired, never resubmit a
// client_order_id we've already resolved, and never blind-retry an outcome we don't know --
// query status first.
import type { KeyObject } from "node:crypto";
import { toFixed } from "../decimal.js";
import { brokerJournalPath as defaultBrokerJournalPath } from "../paths.js";
import { verifyEd25519 } from "./crypto.js";
import { openJournal, replayJournal, type Journal } from "./journal.js";
import * as robinhood from "./robinhood.js";
import type { McpClient } from "./mcp-client.js";
import type {
  Approval,
  ApprovalPayload,
  ApprovedOrder,
  AssetClass,
  BridgeReporter,
  CancelApprovalPayload,
  ExecutionEvent,
  PlaceOrderResult,
  PreviewResult,
} from "./types.js";

export class GatewayRejection extends Error {
  constructor(reason: string) {
    super(`approval rejected: ${reason}`);
    this.name = "GatewayRejection";
  }
}

type OrderState =
  | { state: "in_flight"; promise: Promise<PlaceOrderResult> }
  | { state: "unknown" }
  | { state: "terminal"; result: PlaceOrderResult };

const PLACE_EVENT: Record<PlaceOrderResult["status"], ExecutionEvent> = {
  accepted: "accepted",
  filled: "filled",
  partially_filled: "partially_filled",
  rejected: "rejected",
  canceled: "canceled",
};

export interface GatewayConfig {
  mcp: McpClient;
  reporter: BridgeReporter;
  /** Raw 32-byte Ed25519 public key from the bridge's `hello` response. */
  approvalPublicKey: KeyObject;
  /** Wall-clock nanoseconds "now", for expiry checks -- System.currentTimeMillis()-style clock,
   *  not monotonic; injectable for tests; defaults to Date.now() converted to ns
   *  (millisecond-resolution is more than enough against a multi-second TTL). Clock semantics:
   *  this is compared directly against `expires_ts_ns` from the bridge's own wall clock, so the
   *  expiry check is only as trustworthy as this host's system clock -- an operator (or an
   *  attacker who already has enough access to change the host clock, at which point the
   *  approval signature is the smaller problem) could set the clock backward to keep an expired
   *  approval looking unexpired. Not defended against here; flagging so it isn't assumed to be a
   *  monotonic or tamper-resistant clock. */
  now?: () => number;
  /** Best-effort preview logger (issue #43: every order gets previewed first, and the preview
   *  is logged, before the real order goes out). Defaults to a no-op no console spam in tests;
   *  wire a real logger in production. */
  logPreview?: (order: ApprovedOrder, assetClass: AssetClass, preview: PreviewResult) => void;
  /** Per-call timeout for every Robinhood tool call this gateway makes. Default 5s: short
   *  enough that a stuck broker call surfaces as "outcome unknown" promptly instead of hanging
   *  the caller, long enough for a real network round trip. */
  requestTimeoutMs?: number;
  /** Fsync'd append-only journal path (default out/agent/broker-journal.jsonl, gitignored).
   *  The in-memory idempotency map alone does not survive a process restart; this is what does
   *  -- replayed at construction so a client_order_id sent before a crash comes back as
   *  "unknown" and is reconciled via a status query, never blind-resubmitted. Required before
   *  this gateway ever holds a real broker credential. */
  journalPath?: string;
  /** Fires whenever an order's outcome becomes "unknown" (the placeOrder call itself threw --
   *  root CLAUDE.md "an ambiguous broker response is reconciled before any retry"). This method
   *  already forces the *next* call for that one client_order_id to reconcile via a status query
   *  before ever resubmitting (see `reconcile()` below); this hook is for triggering the wider
   *  broker/bridge reconciliation (agent/src/broker/reconcile.ts) that an ambiguous response
   *  should also prompt -- our books might be wrong about more than just this one order. Fire
   *  and forget on purpose: called synchronously from inside a catch block that is about to
   *  throw the order's own error, so it must never itself throw or be awaited here. */
  onAmbiguousOutcome?: (clientOrderId: number) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function isApprovalPayload(value: unknown): value is ApprovalPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.client_order_id === "number" &&
    typeof p.expires_ts_ns === "number" &&
    typeof p.instrument === "string" &&
    typeof p.limit_price === "string" &&
    typeof p.qty === "string" &&
    typeof p.request_id === "string" &&
    (p.side === "buy" || p.side === "sell") &&
    (p.time_in_force === "ioc" || p.time_in_force === "gtc")
  );
}

/** Protocol v1.2's cancel approval payload -- a distinct, smaller shape from the order-approval
 *  payload above (agent/src/types.ts's `CancelApprovalPayload`). */
function isCancelApprovalPayload(value: unknown): value is CancelApprovalPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return p.action === "cancel" && typeof p.client_order_id === "number" && typeof p.expires_ts_ns === "number";
}

export class BrokerGateway {
  private readonly orders = new Map<number, OrderState>();
  private readonly now: () => number;
  private readonly callOpts: { timeoutMs: number };
  private readonly journal: Journal;

  constructor(private readonly config: GatewayConfig) {
    this.now = config.now ?? (() => Date.now() * 1_000_000);
    this.callOpts = { timeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS };
    const journalPath = config.journalPath ?? defaultBrokerJournalPath();
    this.journal = openJournal(journalPath);
    // Restart safety: seed the in-memory map from whatever the journal already knows, so a
    // client_order_id sent before a crash is never treated as "never sent."
    for (const [clientOrderId, snapshot] of replayJournal(journalPath)) {
      this.orders.set(clientOrderId, snapshot);
    }
  }

  /**
   * Verifies the approval and, only if it verifies, executes the order against Robinhood
   * (mocked, per the hard limits of this build). Throws GatewayRejection, before any network
   * call, for a missing, malformed, tampered, mismatched or expired approval.
   */
  async submitOrder(order: ApprovedOrder, approval: Approval | undefined, assetClass: AssetClass): Promise<PlaceOrderResult> {
    this.assertApproval(order, approval);

    const existing = this.orders.get(order.client_order_id);
    if (existing?.state === "terminal") return existing.result; // duplicate: never resent
    if (existing?.state === "in_flight") return existing.promise; // join the one in-flight attempt
    if (existing?.state === "unknown") return this.reconcile(order, assetClass);

    const promise = this.attemptSubmit(order, assetClass);
    this.orders.set(order.client_order_id, { state: "in_flight", promise });
    return promise;
  }

  /**
   * Protocol v1.2: cancels are approved separately from submits (`CancelApprovalPayload`, not
   * `ApprovalPayload`), verified here the same way `submitOrder` verifies an order approval --
   * signature, field match, expiry against the bridge's own market clock -- before the broker is
   * ever called. Cancels can only reduce exposure, never create it, but an unverified cancel
   * approval is still refused: the authorization bar for "we may tell the broker to cancel this"
   * is the same as the bar for "we may tell the broker to place this".
   */
  async cancelOrder(clientOrderId: number, instrument: string, assetClass: AssetClass, approval: Approval | undefined) {
    this.assertCancelApproval(clientOrderId, approval);
    // Beyond the approval, the authorization bar is also that we ourselves already placed (and
    // hold a terminal, live) state for this client_order_id.
    const existing = this.orders.get(clientOrderId);
    if (!existing || existing.state !== "terminal" || !["accepted", "partially_filled"].includes(existing.result.status)) {
      throw new GatewayRejection(`client_order_id ${clientOrderId} has no live order to cancel`);
    }
    const result = await robinhood.cancelOrder(this.config.mcp, assetClass, clientOrderId, instrument, this.callOpts);
    if (result.status === "canceled") {
      const updated: PlaceOrderResult = { ...existing.result, status: "canceled", reason: result.reason, raw: result.raw };
      this.orders.set(clientOrderId, { state: "terminal", result: updated });
      this.journal.recordResolved(clientOrderId, updated);
    }
    await this.report(clientOrderId, result.status === "canceled" ? "canceled" : "cancel_rejected", {
      reason: result.reason,
    });
    return result;
  }

  /** Parses `approval.payload` as JSON and verifies the signature over its exact bytes --
   *  shared by `assertApproval` (order) and `assertCancelApproval` (cancel); everything past
   *  this point is caller-specific field matching. */
  private verifyApprovalPayload(approval: Approval | undefined): unknown {
    if (!approval) throw new GatewayRejection("missing approval");

    let parsed: unknown;
    try {
      parsed = JSON.parse(approval.payload);
    } catch {
      throw new GatewayRejection("approval payload is not valid JSON");
    }

    // Authenticate the bytes before trusting anything the payload says.
    const sigOk = verifyEd25519(
      this.config.approvalPublicKey,
      Buffer.from(approval.payload, "utf8"),
      Buffer.from(approval.signature, "base64"),
    );
    if (!sigOk) throw new GatewayRejection("approval signature does not verify");

    return parsed;
  }

  private assertApproval(order: ApprovedOrder, approval: Approval | undefined): void {
    const parsed = this.verifyApprovalPayload(approval);
    if (!isApprovalPayload(parsed)) {
      throw new GatewayRejection("approval payload is missing or has malformed fields");
    }

    // qty/limit_price: compare by decimal VALUE (toFixed's bigint), not by string. Wave-2
    // integration finding: the real qc-bridge always signs a fixed 8-fractional-digit spelling
    // ("1.00000000"), but agent/src/decimal.ts's fromFixed() trims trailing zeros ("1") -- the
    // exact same numeric quantity the decider proposed and the bridge risk-checked would fail a
    // byte-for-byte string comparison here on every order whose quantity isn't already spelled
    // with 8 fractional digits, which is effectively every order. This lane's own fake bridge
    // happened to emit the same trimmed spelling the TS side uses, which is why this only
    // surfaced once run against the real binary. The signature itself still covers the exact
    // bytes qc-bridge signed (verifyApprovalPayload, above); only this field-match step compares
    // by value.
    if (
      parsed.client_order_id !== order.client_order_id ||
      parsed.instrument !== order.instrument ||
      parsed.side !== order.side ||
      toFixed(parsed.qty) !== toFixed(order.qty) ||
      toFixed(parsed.limit_price) !== toFixed(order.limit_price) ||
      parsed.time_in_force !== order.time_in_force ||
      parsed.request_id !== order.request_id
    ) {
      throw new GatewayRejection("approval payload does not match the order being submitted");
    }

    if (parsed.expires_ts_ns <= this.now()) {
      throw new GatewayRejection("approval has expired");
    }
  }

  private assertCancelApproval(clientOrderId: number, approval: Approval | undefined): void {
    const parsed = this.verifyApprovalPayload(approval);
    if (!isCancelApprovalPayload(parsed)) {
      throw new GatewayRejection("cancel approval payload is missing or has malformed fields");
    }
    if (parsed.client_order_id !== clientOrderId) {
      throw new GatewayRejection("cancel approval payload does not match the order being cancelled");
    }
    if (parsed.expires_ts_ns <= this.now()) {
      throw new GatewayRejection("cancel approval has expired");
    }
  }

  /** An unknown outcome (the previous placeOrder call threw) is reconciled by asking Robinhood
   *  first -- never resubmitted blindly. Only a confirmed "not_found" makes it safe to actually
   *  place the order for the first time. */
  private async reconcile(order: ApprovedOrder, assetClass: AssetClass): Promise<PlaceOrderResult> {
    const status = await robinhood.getOrderStatus(this.config.mcp, assetClass, order.client_order_id, this.callOpts);
    if (status.status === "not_found") {
      const promise = this.attemptSubmit(order, assetClass);
      this.orders.set(order.client_order_id, { state: "in_flight", promise });
      return promise;
    }
    const result: PlaceOrderResult = {
      status: status.status,
      venue_order_id: status.venue_order_id,
      filled_qty: status.filled_qty,
      avg_price: status.avg_price,
      reason: status.reason,
      raw: status.raw ?? {},
    };
    this.orders.set(order.client_order_id, { state: "terminal", result });
    this.journal.recordResolved(order.client_order_id, result);
    await this.report(order.client_order_id, PLACE_EVENT[result.status], result);
    return result;
  }

  private async attemptSubmit(order: ApprovedOrder, assetClass: AssetClass): Promise<PlaceOrderResult> {
    // Durable BEFORE the network call: if the process crashes between Robinhood receiving this
    // order and us learning the outcome, the journal -- not the in-memory map -- is what
    // remembers it was sent. replayJournal() reads this back as "unknown" on the next start.
    this.journal.recordAttempt(order.client_order_id);

    // Best-effort preview: log it, but a preview failure never blocks the real order -- Robinhood
    // does not force a preview itself (robinhood-agentic-mcp.md §3), this is our own added check.
    try {
      const preview = await robinhood.previewOrder(this.config.mcp, assetClass, order, this.callOpts);
      this.config.logPreview?.(order, assetClass, preview);
    } catch (err) {
      this.config.logPreview?.(order, assetClass, { warnings: [`preview failed: ${(err as Error).message}`], raw: {} });
    }

    let result: PlaceOrderResult;
    try {
      result = await robinhood.placeOrder(this.config.mcp, assetClass, order, this.callOpts);
    } catch (err) {
      // Outcome unknown: could have reached Robinhood and been lost on the way back, or never
      // arrived at all. Either way, never resubmit blindly -- the next call reconciles first.
      this.orders.set(order.client_order_id, { state: "unknown" });
      try {
        this.config.onAmbiguousOutcome?.(order.client_order_id);
      } catch {
        // best effort: a reconcile-trigger failure must never mask the order error below
      }
      throw new Error(`order ${order.client_order_id}: outcome unknown after placeOrder failed: ${(err as Error).message}`);
    }

    this.orders.set(order.client_order_id, { state: "terminal", result });
    this.journal.recordResolved(order.client_order_id, result);
    await this.report(order.client_order_id, PLACE_EVENT[result.status], result);
    return result;
  }

  private async report(
    clientOrderId: number,
    event: ExecutionEvent,
    result: Pick<PlaceOrderResult, "venue_order_id" | "filled_qty" | "avg_price" | "reason">,
  ): Promise<void> {
    const ack = await this.config.reporter.reportExecution({
      op: "report_execution",
      execution: {
        client_order_id: clientOrderId,
        event,
        qty: result.filled_qty,
        price: result.avg_price,
        venue_order_id: result.venue_order_id,
        reason: result.reason,
        ts_ns: this.now(),
      },
    });
    if (!ack.ok) {
      // The order itself is real and already happened; a failed report is a books-integrity
      // problem for ops to chase, not a reason to hide the order's own outcome from the caller.
      // No logging convention exists in agent/ yet (nothing else in src/ calls console.*);
      // stderr is the best available signal until one does.
      console.error(`report_execution for client_order_id ${clientOrderId} was not ok:`, ack.error);
    }
  }
}
