// Hand-written to mirror schemas/decision/v1/*.schema.json (ADR-0040 protocol v1). Both sides
// validate against the JSON Schema files at runtime (src/schema.ts); these types are for
// compile-time checking only and must stay in sync with the schemas.

/** Fixed-point decimal on the wire: `^-?[0-9]+(\.[0-9]{1,8})?$`. Never a JSON number. */
export type DecimalString = string;

export type Direction = "up" | "flat" | "down";
export type Action = "buy" | "sell" | "no_trade";
export type Side = "buy" | "sell";
export type TimeInForce = "ioc" | "gtc";
export type AllowedAction = "buy" | "sell" | "no_trade";

export interface Signal {
  direction: Direction;
  /** [down, flat, up], each 0..1. */
  probs: [number, number, number];
  model_sha256: string;
}

export interface Limits {
  max_position: DecimalString;
  max_notional: DecimalString;
  max_order_rate_per_sec: number;
  remaining_daily_loss: DecimalString;
}

export interface DecisionRequest {
  request_id: string;
  ts_ns: number;
  instrument: string;
  best_bid: DecimalString;
  best_ask: DecimalString;
  mid: DecimalString;
  spread_ticks: number;
  features: Record<string, number>;
  signal: Signal | null;
  position: DecimalString;
  limits: Limits;
  allowed_actions: AllowedAction[];
}

export interface Decision {
  request_id: string;
  action: Action;
  /** Required when action is buy/sell. */
  qty?: DecimalString;
  /** Required when action is buy/sell. */
  limit_price?: DecimalString;
  /** Advisory only; the Rust risk engine decides whether an order is allowed. */
  confidence?: number;
  rationale: string;
}

export interface OrderIntent {
  request_id: string;
  instrument: string;
  side: Side;
  qty: DecimalString;
  limit_price: DecimalString;
  time_in_force: TimeInForce;
  reason: string;
}

export interface IntentResult {
  accepted: boolean;
  client_order_id?: number;
  risk_reject?: string;
  halted?: string;
}

export type BridgeOp = "next_decision_request" | "submit_order_intent" | "no_trade" | "status" | "shutdown";

export interface BridgeRequest {
  v: 1;
  id: string;
  op: BridgeOp;
  intent?: OrderIntent;
  request_id?: string;
  reason?: string;
}

export interface BridgeError {
  code: string;
  message: string;
}

export interface BridgeResponse {
  v: 1;
  id: string;
  ok: boolean;
  decision_request?: DecisionRequest | null;
  result?: IntentResult;
  status?: Record<string, unknown>;
  error?: BridgeError;
}

export type LedgerMode = "fake" | "live" | "replay";

export interface DecisionLedgerEntry {
  request: DecisionRequest;
  decision: Decision;
  result: IntentResult | null;
  mode: LedgerMode;
  prompt_version: string;
  model: string;
  /** Full SDK request/response in live mode; null in fake mode. */
  raw?: unknown;
  cost_usd?: number;
  latency_ms?: number;
}
