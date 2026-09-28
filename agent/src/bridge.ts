// JSON Lines client for qc-bridge (ADR-0040 protocol v1, extended for v1.1/v1.2): spawns the
// bridge process, writes one BridgeRequest per line to its stdin, matches responses back to
// requests by `id` (not by arrival order), and validates every response against
// schemas/decision/v1 before trusting it.
import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import { validateOrThrow } from "./schema.js";
import type {
  BridgeOp,
  BridgeRequest,
  BridgeResponse,
  Hello,
  OrderExecution,
  OrderIntent,
  VenueSnapshot,
} from "./types.js";
import type { BridgeReporter, ReportExecutionAck, ReportExecutionOp } from "./broker/types.js";

export interface BridgeClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout; a request that gets no matching response by then rejects. */
  timeoutMs?: number;
}

interface Pending {
  op: BridgeOp;
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 5_000;

// Protocol v1.2 ops (wave2-spec.md) that schemas/decision/v1/bridge_request.schema.json's `op`
// enum does not list yet -- that file is the bridge-control lane's (wave2/bridge-control), and
// adding these two strings to its closed enum is their job, not this one's. Requests using them
// are checked by hand below instead of through ajv until that schema lands; every other request
// shape (v, id, the op-specific required fields) is still enforced, just not via
// schemas/decision/v1. Same shape as v1.1's approval types living in broker/types.ts before
// bridge-v1.1 merged (see that file's former header, now agent/src/types.ts's).
const V12_ONLY_REQUEST_OPS: ReadonlySet<BridgeOp> = new Set(["cancel_order_intent", "reconcile"]);

function assertValidV12Request(req: BridgeRequest): void {
  if (req.v !== 1) throw new Error(`bridge request v must be 1, got ${JSON.stringify(req.v)}`);
  if (typeof req.id !== "string" || req.id.length === 0) {
    throw new Error("bridge request id must be a non-empty string");
  }
  if (req.op === "cancel_order_intent") {
    if (typeof req.client_order_id !== "number") {
      throw new Error("cancel_order_intent requires client_order_id");
    }
    if (typeof req.reason !== "string") throw new Error("cancel_order_intent requires reason");
    return;
  }
  if (req.op === "reconcile") {
    if (typeof req.venue !== "object" || req.venue === null) {
      throw new Error("reconcile requires venue");
    }
    return;
  }
  throw new Error(`assertValidV12Request called for a non-v1.2-only op: ${req.op}`);
}

/** Structural check for a `hello` response under protocol v1.2 (adds `market_ts_ns`, and
 *  `protocol` becomes "1.2"). schemas/decision/v1/hello.schema.json still pins `protocol` to the
 *  literal "1.1" and forbids extra properties (bridge-control's file, not extended yet), so ajv
 *  rejects a real v1.2 bridge's `hello` response; this is the narrow, hand-written fallback used
 *  only when ajv has already rejected the envelope AND the `hello` object itself looks exactly
 *  like a v1.2 hello -- anything else still fails closed via the original ajv error. */
function isHelloV12Shape(value: unknown): value is Hello {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.protocol === "string" &&
    (v.venue_mode === "sim" || v.venue_mode === "external") &&
    typeof v.approval_public_key === "string" &&
    (v.market_ts_ns === undefined || (typeof v.market_ts_ns === "number" && v.market_ts_ns >= 0))
  );
}

/** Tracks the latest market/feed timestamp the bridge has told us about, from any of the three
 *  wire channels wave2-spec.md names (hello.market_ts_ns, status.market_ts_ns,
 *  decision_request.ts_ns) -- monotonic (never moves backward on an out-of-order or stale
 *  observation), so a single old or malformed reading can't shrink the approval-expiry window. */
class MarketClock {
  private latestNs = 0;

  observe(ns: number | undefined): void {
    if (typeof ns === "number" && Number.isFinite(ns) && ns > this.latestNs) this.latestNs = ns;
  }

  nowNs(): number {
    return this.latestNs;
  }
}

export class BridgeClient implements BridgeReporter {
  private child: ChildProcess | undefined;
  private stdin: Writable | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private closed = false;
  private readonly marketClock = new MarketClock();

  constructor(private readonly opts: BridgeClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The latest market/feed clock reading the bridge has reported (nanoseconds), for anything
   *  that must check an approval's `expires_ts_ns` against the bridge's own time domain instead
   *  of this host's wall clock (schemas/decision/v1/README.md's v1.1 section; wave2-spec.md
   *  extends the requirement to `market_ts_ns`). Returns 0 before any bridge response has
   *  reported a timestamp -- a caller that treats 0 as "already expired" fails closed on an
   *  unstarted clock rather than accepting anything. */
  marketNowNs(): number {
    return this.marketClock.nowNs();
  }

  start(): void {
    if (this.child) throw new Error("BridgeClient.start() already called");
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error("spawned bridge process is missing a stdio pipe");
    }
    this.child = child;
    this.stdin = child.stdin;
    // A write to this pipe after the child has already exited (e.g. shutdown() being called
    // right after a crash -- agent/tests/cli-exit.test.ts) raises EPIPE as an 'error' event on
    // the stream; the `child.on("exit"/"error", ...)` handlers below are what this client
    // actually reacts to for "the bridge died", so an unhandled EPIPE here must not crash the
    // whole process (Node throws if a stream's 'error' event has no listener).
    this.stdin.on("error", () => undefined);
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.stderr.pipe(process.stderr);
    child.on("exit", (code, signal) => {
      this.failEverything(new Error(`bridge process exited (code=${code}, signal=${signal})`));
    });
    child.on("error", (err) => this.failEverything(err));
  }

  /** ajv first, always; the only fallback is the one narrow, known gap described at
   *  `isHelloV12Shape`'s definition -- and only for a response to a request whose `op` this
   *  client itself sent as "hello". Anything else that fails ajv still fails closed. */
  private validateResponse(parsed: unknown, pendingOp: BridgeOp | undefined): void {
    try {
      validateOrThrow("bridge_response", parsed);
      return;
    } catch (err) {
      if (pendingOp === "hello" && typeof parsed === "object" && parsed !== null) {
        const envelope = parsed as Record<string, unknown>;
        const envelopeOk = envelope.v === 1 && typeof envelope.id === "string" && typeof envelope.ok === "boolean";
        if (envelopeOk && isHelloV12Shape(envelope.hello)) return; // accepted: hand-checked v1.2 hello
      }
      throw err;
    }
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // No id to key off: the channel state is now ambiguous, so fail every outstanding
      // call rather than silently drop the line (fail closed, not fail silent).
      this.failEverything(new Error(`bridge sent a non-JSON line: ${trimmed.slice(0, 200)}`));
      return;
    }

    const maybeId = (parsed as { id?: unknown } | null)?.id;
    const id = typeof maybeId === "string" ? maybeId : undefined;
    const pendingOp = id ? this.pending.get(id)?.op : undefined;

    try {
      this.validateResponse(parsed, pendingOp);
    } catch (err) {
      if (id && this.pending.has(id)) {
        this.reject(id, err as Error);
      } else {
        this.failEverything(err as Error);
      }
      return;
    }

    const response = parsed as BridgeResponse;
    if (!this.pending.has(response.id)) return; // already timed out, or unsolicited; ignore

    // wave2-spec.md: the gateway must check approval expiry against the bridge's own market
    // clock, never Date.now() -- fed from whichever of these three channels the response
    // actually carries. MarketClock.observe() is monotonic, so order doesn't matter here.
    this.marketClock.observe(response.decision_request?.ts_ns);
    this.marketClock.observe(response.hello?.market_ts_ns);
    this.marketClock.observe((response.status as { market_ts_ns?: number } | undefined)?.market_ts_ns);

    this.resolveOne(response.id, response);
  }

  private failEverything(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.reject(id, err);
  }

  private resolveOne(id: string, response: BridgeResponse): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(response);
  }

  private reject(id: string, err: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.reject(err);
  }

  private send(req: BridgeRequest): Promise<BridgeResponse> {
    // Never throw synchronously from a Promise-returning method: reject instead, so every
    // caller can uniformly await/.catch() without also needing a try/catch.
    return new Promise<BridgeResponse>((resolve, reject) => {
      if (!this.stdin) {
        reject(new Error("BridgeClient.start() was not called"));
        return;
      }
      const stdin = this.stdin;
      if (V12_ONLY_REQUEST_OPS.has(req.op)) {
        assertValidV12Request(req);
      } else {
        validateOrThrow("bridge_request", req);
      }
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new Error(`bridge request ${req.op} (id=${req.id}) timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(req.id, { op: req.op, resolve, reject, timer });
      stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  nextDecisionRequest(): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "next_decision_request" });
  }

  submitOrderIntent(intent: OrderIntent): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "submit_order_intent", intent });
  }

  noTrade(requestId: string, reason: string): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "no_trade", request_id: requestId, reason });
  }

  status(): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "status" });
  }

  /** Protocol v1.1's handshake, extended by v1.2 with `hello.market_ts_ns` (this method updates
   *  `marketNowNs()` from it the same as any other response, via `onLine`). Callers use the
   *  returned `approval_public_key` to build the Ed25519 `KeyObject` the gateway verifies every
   *  approval against (`agent/src/broker/crypto.ts`'s `ed25519PublicKeyFromRaw`). */
  hello(): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "hello" });
  }

  /** Implements broker/types.ts's `BridgeReporter` -- the concrete wiring that file's header
   *  comment described as "integration work that wires a concrete BridgeReporter once
   *  bridge-v1.1 and this lane both land". `external` venue mode only; a protocol error in `sim`
   *  mode (schemas/decision/v1/README.md). */
  async reportExecution(op: ReportExecutionOp): Promise<ReportExecutionAck> {
    const resp = await this.send({ v: 1, id: randomUUID(), op: "report_execution", execution: op.execution as OrderExecution });
    if (!resp.ok) {
      return { ok: false, error: resp.error ?? { code: "unknown", message: "report_execution failed with no error detail" } };
    }
    return { ok: true };
  }

  /** Protocol v1.2: always allowed for our own open orders (risk never blocks a cancel; an
   *  unknown client_order_id is the bridge's error to return, not this client's to guess at).
   *  `sim` mode routes the cancel to SimVenue directly; `external` mode returns a cancel
   *  `approval` (in `result.approval`, reusing `IntentResult`'s shape) the gateway must verify
   *  the same way it verifies a submit approval, just against the cancel payload shape
   *  (`CancelApprovalPayload`, agent/src/types.ts) instead of the order payload. */
  cancelOrderIntent(clientOrderId: number, reason: string): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "cancel_order_intent", client_order_id: clientOrderId, reason });
  }

  /** Protocol v1.2: compares `venue` (what the broker itself reports) against the bridge's own
   *  OMS/position state. `ok:true` means clean (and, in `external` mode, unblocks new intents --
   *  the bridge refuses them until the first clean reconcile); `ok:false` means the bridge has
   *  already halted on a discrepancy (`error`/`status` on the response carry the diff) -- this
   *  method never decides "mismatch" itself, it only reports what the bridge decided. */
  reconcile(venue: VenueSnapshot): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "reconcile", venue });
  }

  async shutdown(): Promise<void> {
    if (this.child) {
      // `this.closed` means the channel is already known-dead (the child already exited or
      // errored, e.g. agent/tests/cli-exit.test.ts's crash scenario) -- sending a shutdown op it
      // will never answer would just wait out this.timeoutMs for nothing.
      if (!this.closed) {
        try {
          await this.send({ v: 1, id: randomUUID(), op: "shutdown" });
        } catch {
          // best effort: fall through to killing the process regardless
        }
      }
      this.stdin?.end();
      this.child.kill();
    }
    this.failEverything(new Error("BridgeClient.shutdown() called"));
  }
}
