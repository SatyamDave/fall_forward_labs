import type { Decision, DecisionRequest } from "../types.js";

export interface DecisionOutcome {
  decision: Decision;
  /** Full SDK request/response for the ledger's `raw` field; absent in fake mode. */
  raw?: unknown;
  costUsd?: number;
}

export interface Decider {
  decide(req: DecisionRequest): Promise<DecisionOutcome>;
}
