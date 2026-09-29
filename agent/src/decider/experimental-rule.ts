// EXPERIMENTAL deterministic rule decider (QC_AGENT_MODE=experimental-rule). Not a validated
// strategy: its one registered study ended INSUFFICIENT EVIDENCE (1 trade in ~2 h of SOFI). It
// exists so a rule that ignores the (absent) model signal can be exercised end to end in sim.
//
// Long only, whole shares. The decider keeps its own mid-price history across requests, so the
// window and timeout are counted in decision requests; they equal snapshots only at
// `qc-bridge --decide-every 1`. Every proposal still goes through qc-bridge's risk check.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fromFixed, toFixed } from "../decimal.js";
import { repoRoot } from "../paths.js";
import type { Decision, DecisionRequest } from "../types.js";
import type { Decider, DecisionOutcome } from "./types.js";

export interface RuleConfig {
  name: string;
  version: string;
  /** Mean of this many previous mids is the reference price. */
  window: number;
  /** Enter when mid <= mean - entry_below_mean (USD). */
  entry_below_mean: string;
  /** Exit when bid >= entry ask + take_profit (USD per share, so already after spread). */
  take_profit: string;
  /** Exit when bid <= entry ask - stop_loss. */
  stop_loss: string;
  /** Exit at bid after this many requests held. */
  timeout: number;
  /** USD per entry; qty = floor(min(this, limits.max_notional) / ask). */
  max_notional: string;
}

export function defaultRuleConfigPath(): string {
  return path.join(repoRoot(), "config", "strategies", "experimental-dip-reversion.json");
}

export function loadRuleConfig(file = defaultRuleConfigPath()): RuleConfig {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (raw.status !== "EXPERIMENTAL") throw new Error(`${file}: status must be "EXPERIMENTAL"`);
  const str = (k: string) => {
    const v = raw[k];
    if (typeof v !== "string" || toFixed(v) <= 0n) throw new Error(`${file}: ${k} must be a positive decimal string`);
    return v;
  };
  const int = (k: string) => {
    const v = raw[k];
    if (!Number.isInteger(v) || (v as number) <= 0) throw new Error(`${file}: ${k} must be a positive integer`);
    return v as number;
  };
  if (typeof raw.name !== "string" || typeof raw.version !== "string") {
    throw new Error(`${file}: name and version must be strings`);
  }
  return {
    name: raw.name,
    version: raw.version,
    window: int("window"),
    entry_below_mean: str("entry_below_mean"),
    take_profit: str("take_profit"),
    stop_loss: str("stop_loss"),
    timeout: int("timeout"),
    max_notional: str("max_notional"),
  };
}

const ONE = toFixed("1");
const usd = (v: bigint) => `$${fromFixed(v)}`;

export class ExperimentalRuleDecider implements Decider {
  private readonly mids: bigint[] = [];
  /** Ask we bought at; set when a buy is proposed, cleared whenever the position is flat. */
  private entry: bigint | undefined;
  private held = 0;

  constructor(readonly config: RuleConfig) {}

  get label(): string {
    return `experimental-rule:${this.config.name}-${this.config.version}`;
  }

  async decide(req: DecisionRequest): Promise<DecisionOutcome> {
    const decision = this.decideSync(req);
    return { decision, raw: { experimental: true, rule: this.label } };
  }

  private decideSync(req: DecisionRequest): Decision {
    const c = this.config;
    const mid = toFixed(req.mid);
    const bid = toFixed(req.best_bid);
    const ask = toFixed(req.best_ask);
    const position = toFixed(req.position);
    // Mean of the previous `window` mids, excluding this one; then record this one.
    const mean = this.mids.length >= c.window ? this.mids.reduce((a, b) => a + b, 0n) / BigInt(c.window) : undefined;
    this.mids.push(mid);
    if (this.mids.length > c.window) this.mids.shift();

    const tag = `[EXPERIMENTAL ${this.label}]`;
    const noTrade = (why: string): Decision => ({ request_id: req.request_id, action: "no_trade", rationale: `${tag} ${why}` });

    if (position < 0n) return noTrade(`position ${req.position} is short; this rule is long only and does not act`);

    if (position === 0n) {
      this.entry = undefined;
      this.held = 0;
      if (mean === undefined) return noTrade(`warming up: ${this.mids.length}/${c.window + 1} mids seen`);
      const threshold = mean - toFixed(c.entry_below_mean);
      if (mid > threshold) return noTrade(`flat; mid ${usd(mid)} above entry threshold ${usd(threshold)}`);
      if (!req.allowed_actions.includes("buy")) return noTrade("entry signal, but buy is not in allowed_actions");
      const qty = this.entryQty(req, ask);
      if (qty <= 0n) return noTrade(`entry signal, but size floors to 0 shares at ask ${usd(ask)} under the limits`);
      this.entry = ask;
      return {
        request_id: req.request_id,
        action: "buy",
        qty: fromFixed(qty),
        limit_price: req.best_ask,
        rationale:
          `${tag} entry: mid ${usd(mid)} <= ${c.window}-request mean ${usd(mean)} - ${usd(toFixed(c.entry_below_mean))}; ` +
          `buy ${fromFixed(qty)} at ask ${usd(ask)} (spread ${usd(ask - bid)}). ` +
          `Exit plan: sell at bid when bid >= ${usd(ask + toFixed(c.take_profit))} (take profit), ` +
          `bid <= ${usd(ask - toFixed(c.stop_loss))} (stop) or after ${c.timeout} requests. ` +
          `Expected edge after spread: +${usd(toFixed(c.take_profit))}/share on take profit, ` +
          `-${usd(toFixed(c.stop_loss))}/share on stop; break-even needs a take-profit rate above ` +
          `${Math.round((100 * Number(c.stop_loss)) / (Number(c.stop_loss) + Number(c.take_profit)))}%, not measured.`,
      };
    }

    // Long. A position this rule did not open (restart, manual trade) has no known entry: flatten.
    const sellQty = (position / ONE) * ONE; // whole shares, never more than held
    const exitReason = (() => {
      if (this.entry === undefined) return "position was not opened by this rule (entry unknown): flatten";
      this.held += 1;
      const entry = this.entry;
      if (bid >= entry + toFixed(c.take_profit)) return `take profit: bid ${usd(bid)} >= entry ${usd(entry)} + ${usd(toFixed(c.take_profit))}`;
      if (bid <= entry - toFixed(c.stop_loss)) return `stop: bid ${usd(bid)} <= entry ${usd(entry)} - ${usd(toFixed(c.stop_loss))}`;
      if (this.held >= c.timeout) return `timeout: held ${this.held} requests >= ${c.timeout}`;
      return undefined;
    })();
    if (exitReason === undefined) {
      return noTrade(`holding ${req.position} from ${usd(this.entry as bigint)}; bid ${usd(bid)}, held ${this.held}/${c.timeout}`);
    }
    if (sellQty <= 0n) return noTrade(`${exitReason}, but position ${req.position} is under one whole share`);
    if (!req.allowed_actions.includes("sell")) return noTrade(`${exitReason}, but sell is not in allowed_actions`);
    const pnl = this.entry === undefined ? "unknown" : usd(((bid - this.entry) * sellQty) / ONE);
    return {
      request_id: req.request_id,
      action: "sell",
      qty: fromFixed(sellQty),
      limit_price: req.best_bid,
      rationale: `${tag} exit (${exitReason}); sell ${fromFixed(sellQty)} at bid ${usd(bid)}, P&L after spread ${pnl}.`,
    };
  }

  private entryQty(req: DecisionRequest, ask: bigint): bigint {
    const cfgNotional = toFixed(this.config.max_notional);
    const reqNotional = toFixed(req.limits.max_notional);
    const notional = cfgNotional < reqNotional ? cfgNotional : reqNotional;
    let shares = ask > 0n ? notional / ask : 0n; // both scale 1e8, so this is whole shares
    const room = (toFixed(req.limits.max_position) - toFixed(req.position)) / ONE;
    if (room < shares) shares = room;
    return shares > 0n ? shares * ONE : 0n;
  }
}
