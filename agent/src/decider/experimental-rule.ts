// EXPERIMENTAL deterministic rule decider (QC_AGENT_MODE=experimental-rule). Not a validated
// strategy: its one registered study ended INSUFFICIENT EVIDENCE (1 trade in ~2 h of SOFI). It
// exists so a rule that ignores the (absent) model signal can be exercised end to end in sim.
//
// Long only, whole shares. The decider keeps its own mid-price history across requests; the
// mean window and the timeout are measured in the requests' own ts_ns, never in request counts.
// Every proposal still goes through qc-bridge's risk check.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fromFixed, toFixed } from "../decimal.js";
import { repoRoot } from "../paths.js";
import type { Decision, DecisionRequest, IntentResult, Side } from "../types.js";
import type { Decider, DecisionOutcome } from "./types.js";

export interface RuleConfig {
  name: string;
  version: string;
  /** The reference price is the mean of the in-hours mids from this many seconds before the request. */
  window_seconds: number;
  /** A gap longer than this between two in-hours requests restarts the window from empty. */
  max_gap_seconds: number;
  /** Enter when mid <= mean - entry_below_mean (USD). */
  entry_below_mean: string;
  /** Enter only when 0 < ask - bid <= tick_size (USD): a one-tick book. */
  tick_size: string;
  /** Exit when bid >= entry ask + take_profit (USD per share, so already after spread). */
  take_profit: string;
  /** Exit when bid <= entry ask - stop_loss. */
  stop_loss: string;
  /** Exit at bid once this many seconds have passed since the entry request. */
  timeout_seconds: number;
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
    window_seconds: int("window_seconds"),
    max_gap_seconds: int("max_gap_seconds"),
    entry_below_mean: str("entry_below_mean"),
    tick_size: str("tick_size"),
    take_profit: str("take_profit"),
    stop_loss: str("stop_loss"),
    timeout_seconds: int("timeout_seconds"),
    max_notional: str("max_notional"),
  };
}

const ONE = toFixed("1");
const NS_PER_SEC = 1_000_000_000;
const usd = (v: bigint) => `$${fromFixed(v)}`;

export class ExperimentalRuleDecider implements Decider {
  /** In-hours mids with their request ts_ns, oldest first. */
  private readonly mids: { ts: number; mid: bigint }[] = [];
  /** ts_ns of the first mid since the window last (re)started; the mean needs a full window. */
  private windowStart: number | undefined;
  /** Ask and ts_ns of the buy this rule proposed; cleared whenever the position is flat. */
  private entry: { ask: bigint; ts: number } | undefined;
  /** The last buy/sell proposed, the position it was proposed from, and what the bridge said. */
  private proposed: { side: Side; position: bigint; result?: IntentResult | null } | undefined;
  /** A side whose last proposal left the position unchanged; not proposed again until it moves. */
  private blocked: { side: Side; position: bigint; why: string } | undefined;

  constructor(readonly config: RuleConfig) {}

  get label(): string {
    return `experimental-rule:${this.config.name}-${this.config.version}`;
  }

  async decide(req: DecisionRequest): Promise<DecisionOutcome> {
    const decision = this.decideSync(req);
    this.proposed =
      decision.action === "no_trade" ? undefined : { side: decision.action, position: toFixed(req.position) };
    return { decision, raw: { experimental: true, rule: this.label } };
  }

  observe(result: IntentResult | null): void {
    if (this.proposed) this.proposed.result = result;
  }

  /** Mean of the in-hours window before this request, or undefined while it is not yet full;
   *  then records this request's mid. */
  private meanThenRecord(req: DecisionRequest, mid: bigint): bigint | undefined {
    const c = this.config;
    const ts = req.ts_ns;
    // Outside trading hours the bridge offers only no_trade; those quotes are not the market.
    if (!req.allowed_actions.includes("buy") && !req.allowed_actions.includes("sell")) return undefined;
    const last = this.mids.at(-1);
    if (last && ts - last.ts > c.max_gap_seconds * NS_PER_SEC) this.mids.length = 0;
    if (this.mids.length === 0) this.windowStart = ts;
    const cutoff = ts - c.window_seconds * NS_PER_SEC;
    while ((this.mids[0]?.ts ?? cutoff) < cutoff) this.mids.shift();
    const full = this.windowStart !== undefined && this.windowStart <= cutoff && this.mids.length > 0;
    const mean = full ? this.mids.reduce((a, m) => a + m.mid, 0n) / BigInt(this.mids.length) : undefined;
    this.mids.push({ ts, mid });
    return mean;
  }

  /** A proposal that left the position unchanged (rejected, or an IOC that did not fill) blocks
   *  that side until the position moves, so the rule does not re-propose it every request. */
  private updateBlock(position: bigint): void {
    const p = this.proposed;
    if (p && p.position === position) {
      const what = p.side === "sell" ? "closing sell" : "entry buy";
      const r = p.result;
      const why = r && !r.accepted ? `${what} rejected, ${r.risk_reject ?? r.halted ?? "no reason given"}` : `${what} accepted but not filled`;
      this.blocked = { side: p.side, position, why };
    }
    this.proposed = undefined;
    if (this.blocked && this.blocked.position !== position) this.blocked = undefined;
  }

  private decideSync(req: DecisionRequest): Decision {
    const c = this.config;
    const mid = toFixed(req.mid);
    const bid = toFixed(req.best_bid);
    const ask = toFixed(req.best_ask);
    const position = toFixed(req.position);
    const mean = this.meanThenRecord(req, mid);
    this.updateBlock(position);

    const tag = `[EXPERIMENTAL ${this.label}]`;
    const noTrade = (why: string): Decision => ({ request_id: req.request_id, action: "no_trade", rationale: `${tag} ${why}` });
    const blockedFor = (side: Side) =>
      this.blocked?.side === side
        ? noTrade(`blocked: ${this.blocked.why}; not re-proposing until the position changes. Needs a human.`)
        : undefined;

    if (position < 0n) return noTrade(`position ${req.position} is short; this rule is long only and does not act`);

    if (position === 0n) {
      this.entry = undefined;
      if (mean === undefined) return noTrade(`warming up: under ${c.window_seconds}s of in-hours mids since the window started`);
      const threshold = mean - toFixed(c.entry_below_mean);
      if (mid > threshold) return noTrade(`flat; mid ${usd(mid)} above entry threshold ${usd(threshold)}`);
      if (!req.allowed_actions.includes("buy")) return noTrade("entry signal, but buy is not in allowed_actions");
      if (!(bid < ask && ask - bid <= toFixed(c.tick_size))) {
        return noTrade(`entry signal, but spread ${usd(ask - bid)} is not one tick (${usd(toFixed(c.tick_size))})`);
      }
      const remaining = req.limits.remaining_daily_notional;
      if (remaining === undefined) {
        return noTrade("entry signal, but the request has no remaining_daily_notional (bridge before protocol v1.3)");
      }
      const qty = this.entryQty(req, ask, toFixed(remaining));
      if (qty <= 0n) {
        return noTrade(
          `entry signal, but size floors to 0 shares at ask ${usd(ask)} under the limits ` +
            `(remaining_daily_notional ${usd(toFixed(remaining))} must cover the buy and its exit)`,
        );
      }
      const blocked = blockedFor("buy");
      if (blocked) return blocked;
      this.entry = { ask, ts: req.ts_ns };
      return {
        request_id: req.request_id,
        action: "buy",
        qty: fromFixed(qty),
        limit_price: req.best_ask,
        rationale:
          `${tag} entry: mid ${usd(mid)} <= ${c.window_seconds}s mean ${usd(mean)} - ${usd(toFixed(c.entry_below_mean))}; ` +
          `buy ${fromFixed(qty)} at ask ${usd(ask)} (spread ${usd(ask - bid)}). ` +
          `Exit plan: sell at bid when bid >= ${usd(ask + toFixed(c.take_profit))} (take profit), ` +
          `bid <= ${usd(ask - toFixed(c.stop_loss))} (stop) or after ${c.timeout_seconds}s. ` +
          `Expected edge after spread: +${usd(toFixed(c.take_profit))}/share on take profit, ` +
          `-${usd(toFixed(c.stop_loss))}/share on stop; break-even needs a take-profit rate above ` +
          `${Math.round((100 * Number(c.stop_loss)) / (Number(c.stop_loss) + Number(c.take_profit)))}%, not measured.`,
      };
    }

    // Long. A position this rule did not open (restart, manual trade) has no known entry and so
    // no exit plan; a person decides what to do with it.
    if (this.entry === undefined) {
      return noTrade(`HUMAN REVIEW: holding ${req.position} this rule did not open (entry unknown); not trading it`);
    }
    const entry = this.entry.ask;
    const heldSeconds = Math.floor((req.ts_ns - this.entry.ts) / NS_PER_SEC);
    const sellQty = (position / ONE) * ONE; // whole shares, never more than held
    const exitReason = (() => {
      if (bid >= entry + toFixed(c.take_profit)) return `take profit: bid ${usd(bid)} >= entry ${usd(entry)} + ${usd(toFixed(c.take_profit))}`;
      if (bid <= entry - toFixed(c.stop_loss)) return `stop: bid ${usd(bid)} <= entry ${usd(entry)} - ${usd(toFixed(c.stop_loss))}`;
      if (heldSeconds >= c.timeout_seconds) return `timeout: held ${heldSeconds}s >= ${c.timeout_seconds}s`;
      return undefined;
    })();
    if (exitReason === undefined) {
      return noTrade(`holding ${req.position} from ${usd(entry)}; bid ${usd(bid)}, held ${heldSeconds}s/${c.timeout_seconds}s`);
    }
    if (sellQty <= 0n) return noTrade(`${exitReason}, but position ${req.position} is under one whole share`);
    if (!req.allowed_actions.includes("sell")) return noTrade(`${exitReason}, but sell is not in allowed_actions`);
    const blocked = blockedFor("sell");
    if (blocked) return blocked;
    return {
      request_id: req.request_id,
      action: "sell",
      qty: fromFixed(sellQty),
      limit_price: req.best_bid,
      rationale: `${tag} exit (${exitReason}); sell ${fromFixed(sellQty)} at bid ${usd(bid)}, P&L after spread ${usd(((bid - entry) * sellQty) / ONE)}.`,
    };
  }

  /** Whole shares under the config and request notional, the position room, and today's
   *  remaining daily notional, which must cover the buy plus its worst-case exit,
   *  qty * (ask + take_profit): risk charges both orders when it accepts them, filled or not. */
  private entryQty(req: DecisionRequest, ask: bigint, remainingDaily: bigint): bigint {
    const cfgNotional = toFixed(this.config.max_notional);
    const reqNotional = toFixed(req.limits.max_notional);
    const notional = cfgNotional < reqNotional ? cfgNotional : reqNotional;
    let shares = ask > 0n ? notional / ask : 0n; // both scale 1e8, so this is whole shares
    const roundTripPerShare = ask + ask + toFixed(this.config.take_profit);
    const dailyShares = remainingDaily > 0n ? remainingDaily / roundTripPerShare : 0n;
    if (dailyShares < shares) shares = dailyShares;
    const room = (toFixed(req.limits.max_position) - toFixed(req.position)) / ONE;
    if (room < shares) shares = room;
    return shares > 0n ? shares * ONE : 0n;
  }
}
