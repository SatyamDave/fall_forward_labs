// The decision loop: next_decision_request -> decide -> submit_order_intent or no_trade ->
// ledger, until the bridge's feed is exhausted (decision_request: null).
import type { BridgeClient } from "./bridge.js";
import type { Decider } from "./decider/types.js";
import { appendLedgerEntry } from "./ledger.js";
import type { Decision, DecisionRequest, IntentResult, LedgerMode, Side } from "./types.js";

function isTradeDecision(decision: Decision): decision is Decision & { action: Side } {
  return decision.action !== "no_trade";
}

export interface LoopCounts {
  decisions: number;
  accepted: number;
  rejected: number;
  noTrades: number;
}

export interface LoopOptions {
  bridge: BridgeClient;
  decider: Decider;
  mode: LedgerMode;
  promptVersion: string;
  model: string;
  ledgerPath?: string;
}

export async function runLoop(opts: LoopOptions): Promise<LoopCounts> {
  const counts: LoopCounts = { decisions: 0, accepted: 0, rejected: 0, noTrades: 0 };

  for (;;) {
    const next = await opts.bridge.nextDecisionRequest();
    if (!next.ok) {
      throw new Error(`bridge next_decision_request failed: ${next.error?.code} ${next.error?.message}`);
    }
    const request: DecisionRequest | null | undefined = next.decision_request;
    if (!request) break; // feed exhausted

    const startedAt = Date.now();
    const { decision, raw, costUsd } = await opts.decider.decide(request);
    // Wall-clock latency is recorded only for live decisions. Fake and replay deciders do no
    // real work, so their timing is noise, and recording it makes the ledger differ between two
    // runs of the same input (replay's whole contract is that it doesn't).
    const latencyMs = opts.mode === "live" ? Date.now() - startedAt : undefined;
    counts.decisions += 1;

    const intentResult = isTradeDecision(decision)
      ? await submitOrder(opts.bridge, request, decision, counts)
      : await submitNoTrade(opts.bridge, decision.request_id, decision.rationale, counts);

    appendLedgerEntry(
      {
        request,
        decision,
        result: intentResult,
        mode: opts.mode,
        prompt_version: opts.promptVersion,
        model: opts.model,
        raw: raw ?? null,
        cost_usd: costUsd,
        latency_ms: latencyMs,
      },
      opts.ledgerPath,
    );
  }

  return counts;
}

async function submitNoTrade(
  bridge: BridgeClient,
  requestId: string,
  reason: string,
  counts: LoopCounts,
): Promise<null> {
  const resp = await bridge.noTrade(requestId, reason);
  if (!resp.ok) {
    throw new Error(`bridge no_trade failed: ${resp.error?.code} ${resp.error?.message}`);
  }
  counts.noTrades += 1;
  return null;
}

async function submitOrder(
  bridge: BridgeClient,
  request: DecisionRequest,
  decision: Decision & { action: Side },
  counts: LoopCounts,
): Promise<IntentResult | null> {
  if (!decision.qty || !decision.limit_price) {
    throw new Error(`decision for ${decision.request_id} is ${decision.action} but is missing qty/limit_price`);
  }
  const resp = await bridge.submitOrderIntent({
    request_id: decision.request_id,
    instrument: request.instrument,
    side: decision.action,
    qty: decision.qty,
    limit_price: decision.limit_price,
    time_in_force: "ioc",
    reason: decision.rationale,
  });
  if (!resp.ok) {
    throw new Error(`bridge submit_order_intent failed: ${resp.error?.code} ${resp.error?.message}`);
  }
  const result = resp.result ?? null;
  if (result?.accepted) counts.accepted += 1;
  else counts.rejected += 1;
  return result;
}
