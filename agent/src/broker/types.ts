// Protocol v1.1 types (additive to v1 -- see this session's wave-spec.md "Protocol v1.1" and,
// once bridge-v1.1 lands, schemas/decision/v1/README.md's "minor version" note). These are
// hand-written mirrors of the JSON the Rust bridge emits, the same convention agent/src/types.ts
// already uses for v1. They intentionally do NOT live in agent/src/types.ts: that file is shared
// with other in-flight lanes this wave, and schemas/decision/v1/** is bridge-v1.1's lane, not
// this one's -- see agent/src/broker/CLAUDE.md-equivalent note in the PR body. Reconciling this
// file with the shared types once both lanes land is follow-up integration work, not this PR's.
import type { DecimalString, Side, TimeInForce } from "../types.js";

export type { DecimalString, Side, TimeInForce };

/**
 * Canonical approval payload: qc-bridge builds this JSON object with sorted keys and no
 * whitespace, then signs the UTF-8 bytes of exactly that string. The gateway must treat
 * `Approval.payload` as the only thing it ever verifies a signature over -- never a
 * reconstructed/reserialized string, which could accidentally differ in formatting even when
 * the content matches.
 */
export interface ApprovalPayload {
  client_order_id: number;
  /** u64 nanoseconds on the wire. Parsed with plain JSON.parse, which rounds to the nearest
   *  double once the value exceeds 2^53 -- for a wall-clock nanosecond epoch timestamp that's
   *  an error of a few hundred ns at most (ULP near 1.7e18 is ~400ns), utterly negligible
   *  against a 5-second TTL.
   *  ponytail: bounded precision loss, fine down to microsecond TTLs; if the bridge ever issues
   *  approvals with sub-microsecond TTLs, switch to a bigint-preserving JSON parse. */
  expires_ts_ns: number;
  instrument: string;
  limit_price: DecimalString;
  qty: DecimalString;
  request_id: string;
  side: Side;
  time_in_force: TimeInForce;
}

export interface Approval {
  /** Canonical JSON string, exactly as signed -- verify against these exact bytes. */
  payload: string;
  /** Base64 Ed25519 signature over the UTF-8 bytes of `payload`. */
  signature: string;
}

/** The order the gateway is about to submit. Every field here must equal the corresponding
 *  field parsed out of a verified `Approval.payload`, or the door refuses to open. */
export interface ApprovedOrder {
  client_order_id: number;
  instrument: string;
  side: Side;
  qty: DecimalString;
  limit_price: DecimalString;
  time_in_force: TimeInForce;
  request_id: string;
}

export type AssetClass = "equity" | "crypto";

export type ExecutionEvent =
  | "accepted"
  | "rejected"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "cancel_rejected";

export interface ReportExecutionOp {
  op: "report_execution";
  execution: {
    client_order_id: number;
    event: ExecutionEvent;
    qty?: DecimalString;
    price?: DecimalString;
    venue_order_id?: string;
    ts_ns: number;
    reason?: string;
  };
}

export interface ReportExecutionAck {
  ok: boolean;
  error?: { code: string; message: string };
}

/**
 * What the gateway needs from qc-bridge to report fills/acks back into its OMS. Deliberately
 * NOT `agent/src/bridge.ts`'s `BridgeClient`: that class speaks only the frozen v1 op set
 * (`next_decision_request`/`submit_order_intent`/`no_trade`/`status`/`shutdown`) and is owned by
 * a different lane this wave. A v1.1-aware `BridgeClient.reportExecution()` (and the `hello`
 * handshake that hands the gateway its Ed25519 public key) is the integration work that wires a
 * concrete `BridgeReporter` once bridge-v1.1 and this lane both land -- see the PR body.
 */
export interface BridgeReporter {
  reportExecution(op: ReportExecutionOp): Promise<ReportExecutionAck>;
}

/** Normalized broker outcome, in our own vocabulary. `raw` keeps whatever the (real or mock)
 *  Robinhood tool actually returned, for audit -- normalization happens once, in robinhood.ts. */
export interface PlaceOrderResult {
  status: "accepted" | "filled" | "partially_filled" | "rejected" | "canceled";
  venue_order_id?: string;
  filled_qty?: DecimalString;
  avg_price?: DecimalString;
  reason?: string;
  raw: Record<string, unknown>;
}

export interface OrderStatusResult {
  status: PlaceOrderResult["status"] | "not_found";
  venue_order_id?: string;
  filled_qty?: DecimalString;
  avg_price?: DecimalString;
  reason?: string;
  raw: Record<string, unknown> | null;
}

export interface CancelOrderResult {
  status: "canceled" | "cancel_rejected";
  reason?: string;
  raw: Record<string, unknown>;
}

export interface PreviewResult {
  warnings: string[];
  raw: Record<string, unknown>;
}
