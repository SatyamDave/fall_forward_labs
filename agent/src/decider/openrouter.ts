// OpenRouter decider (QC_AGENT_MODE=openrouter, ADR-0042): one chat-completions call to a free
// OpenRouter model, no tools, JSON only. Every way the call can go wrong (HTTP error, 429,
// timeout, non-JSON, schema-invalid, an action or size the request does not allow) becomes
// no_trade with the reason in `raw`; nothing is retried, so a failure can never turn into a trade.
// Spend is the one thing that throws: a positive cost past the daily cap stops the loop.
import { absFixed, fromFixed, toFixed, usdToDecimalString } from "../decimal.js";
import { getValidator } from "../schema.js";
import type { DecimalString, Decision, DecisionRequest } from "../types.js";
import { buildPrompt, resolvePromptVersion, runAiGate } from "./live.js";
import type { Decider, DecisionOutcome } from "./types.js";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_LOOP = "loop-agent-openrouter";
const DEFAULT_TIMEOUT_MS = 20_000;

// decide-v1.md tells the model to call a tool; this mode registers none.
const JSON_ONLY_SUFFIX =
  "\n## This run has no tools\n\nNo tools are available. Reply with exactly one JSON object matching the " +
  "Decision schema above and nothing else: no prose, no code fence.\n";

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** min(QC_OPENROUTER_MAX_USD_PER_DAY, POLICY.yaml loop-agent-openrouter.daily_usd). */
  maxUsdPerDay: bigint;
}

/** Fails closed before any network call: missing key or model, bad numbers, or ai_gate denying. */
export function resolveOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("openrouter mode refused: OPENROUTER_API_KEY is not set");
  const model = env.QC_OPENROUTER_MODEL;
  if (!model) {
    throw new Error(
      "openrouter mode refused: QC_OPENROUTER_MODEL is not set (pick a model id ending in \":free\" " +
        "from https://openrouter.ai/models?max_price=0)",
    );
  }
  const rawTimeout = env.QC_OPENROUTER_TIMEOUT_MS;
  if (rawTimeout !== undefined && !/^[1-9]\d*$/.test(rawTimeout)) {
    throw new Error(`QC_OPENROUTER_TIMEOUT_MS must be a positive integer, got ${JSON.stringify(rawTimeout)}`);
  }
  const envCap = toFixed(env.QC_OPENROUTER_MAX_USD_PER_DAY ?? "0"); // throws on a non-decimal
  if (envCap < 0n) throw new Error("QC_OPENROUTER_MAX_USD_PER_DAY must not be negative");
  if (envCap === 0n && !model.endsWith(":free")) {
    throw new Error(
      `openrouter mode refused: ${model} is not a ":free" model and QC_OPENROUTER_MAX_USD_PER_DAY is 0`,
    );
  }
  const gate = runAiGate(OPENROUTER_LOOP, "openrouter", env);
  const policyCap = toFixed(usdToDecimalString(Number(gate.max_budget_usd)));
  return {
    apiKey,
    model,
    timeoutMs: rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout),
    maxUsdPerDay: envCap < policyCap ? envCap : policyCap,
  };
}

/** Why a model's decision is not acceptable for this request, or undefined when it is. */
export function rejectReason(req: DecisionRequest, decision: Decision): string | undefined {
  const validate = getValidator("decision");
  if (!validate(decision)) return `schema-invalid: ${JSON.stringify(validate.errors)}`;
  if (decision.request_id !== req.request_id) return `request_id ${decision.request_id} does not match`;
  if (!req.allowed_actions.includes(decision.action)) return `${decision.action} is not in allowed_actions`;
  if (decision.action === "no_trade") return undefined;
  const qty = toFixed(decision.qty!);
  const price = toFixed(decision.limit_price!);
  if (qty <= 0n) return "qty must be positive";
  if (price <= 0n) return "limit_price must be positive";
  const newPosition = toFixed(req.position) + (decision.action === "buy" ? qty : -qty);
  if (absFixed(newPosition) > absFixed(toFixed(req.limits.max_position))) {
    return `resulting position ${fromFixed(newPosition)} exceeds max_position ${req.limits.max_position}`;
  }
  if ((qty * price) / 100_000_000n > absFixed(toFixed(req.limits.max_notional))) {
    return `notional exceeds max_notional ${req.limits.max_notional}`;
  }
  return undefined;
}

function parseContent(content: unknown): unknown {
  if (typeof content !== "string") throw new Error("response has no message content");
  // Weaker models fence JSON even when told not to; the fence adds nothing, the schema still decides.
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  return JSON.parse(fenced ? fenced[1]! : content);
}

export interface OpenRouterDeciderOptions {
  /** Tests point this at a local mock server; production always uses OPENROUTER_ENDPOINT. */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  /** Tests pass a resolved config to exercise decide() without an allowing ai_gate. */
  config?: OpenRouterConfig;
}

export class OpenRouterDecider implements Decider {
  readonly promptVersion: string;
  readonly config: OpenRouterConfig;
  private readonly endpoint: string;
  // ponytail: in-process daily total, reset on restart; read today's cost from the ledger if a
  // positive cap is ever set and the process is supervised with restarts.
  private spent = { day: "", usd: 0n };

  constructor(opts: OpenRouterDeciderOptions = {}) {
    const env = opts.env ?? process.env;
    this.config = opts.config ?? resolveOpenRouterConfig(env);
    this.promptVersion = resolvePromptVersion(env);
    this.endpoint = opts.endpoint ?? OPENROUTER_ENDPOINT;
  }

  async decide(req: DecisionRequest): Promise<DecisionOutcome> {
    const body = {
      model: this.config.model,
      messages: [{ role: "user", content: buildPrompt(req, this.promptVersion) + JSON_ONLY_SUFFIX }],
      response_format: { type: "json_object" },
    };
    const raw: Record<string, unknown> = { request: body };
    const noTrade = (reason: string): DecisionOutcome => {
      raw.no_trade_reason = reason;
      return { decision: { request_id: req.request_id, action: "no_trade", rationale: `openrouter: ${reason}`.slice(0, 500) }, raw };
    };

    let json: Record<string, unknown>;
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const text = await res.text();
      raw.status = res.status;
      raw.response = text;
      if (!res.ok) return noTrade(`HTTP ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
      json = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      return noTrade(`request failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    }

    const costUsd = this.recordCost(json, raw);

    let candidate: unknown;
    try {
      const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
      candidate = parseContent(choices?.[0]?.message?.content);
    } catch (err) {
      return { ...noTrade(`non-JSON decision: ${err instanceof Error ? err.message : String(err)}`), costUsd };
    }
    const reason = rejectReason(req, candidate as Decision);
    if (reason) return { ...noTrade(reason), costUsd };
    return { decision: candidate as Decision, raw, costUsd };
  }

  /** Returns cost_usd for the ledger (undefined when OpenRouter reported none: the ledger schema
   *  only takes a decimal, so "unknown" goes in raw). Throws when the daily cap would be exceeded. */
  private recordCost(json: Record<string, unknown>, raw: Record<string, unknown>): DecimalString | undefined {
    const cost = (json.usage as { cost?: unknown } | undefined)?.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      raw.cost_usd = "unknown";
      // Unknown spend is only tolerable on a model OpenRouter prices at zero.
      if (!this.config.model.endsWith(":free")) {
        throw new Error(`openrouter mode stopped: ${this.config.model} reported no usable cost; refusing to continue`);
      }
      return undefined;
    }
    // A positive cost below 1e-8 must not round to a recorded "0".
    const fixed = cost > 0 && toFixed(usdToDecimalString(cost)) === 0n ? 1n : toFixed(usdToDecimalString(cost));
    const usd = fromFixed(fixed);
    if (fixed > 0n) {
      const day = new Date().toISOString().slice(0, 10);
      if (this.spent.day !== day) this.spent = { day, usd: 0n };
      this.spent.usd += fixed;
      if (this.spent.usd > this.config.maxUsdPerDay) {
        throw new Error(
          `openrouter mode stopped: spent ${fromFixed(this.spent.usd)} USD today, over the ` +
            `${fromFixed(this.config.maxUsdPerDay)} USD cap (QC_OPENROUTER_MAX_USD_PER_DAY)`,
        );
      }
    }
    return usd;
  }
}
