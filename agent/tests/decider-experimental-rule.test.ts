import { describe, expect, it } from "vitest";
import { ExperimentalRuleDecider, loadRuleConfig, type RuleConfig } from "../src/decider/experimental-rule.js";
import type { Decider } from "../src/decider/types.js";
import type { DecisionRequest, IntentResult } from "../src/types.js";

const config: RuleConfig = {
  name: "dip-reversion",
  version: "test",
  window_seconds: 3,
  max_gap_seconds: 10,
  entry_below_mean: "0.03",
  tick_size: "0.01",
  take_profit: "0.02",
  stop_loss: "0.04",
  timeout_seconds: 5,
  max_notional: "25",
};

const SEC = 1_000_000_000;
let n = 0;
let t = 0;
/** A one-cent-wide book around `mid`, one second after the previous request unless ts_ns is given. */
function req(mid: string, overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  const m = Number(mid);
  t = overrides.ts_ns ?? t + SEC;
  return {
    request_id: `r-${++n}`,
    ts_ns: t,
    instrument: "SOFI",
    best_bid: (m - 0.005).toFixed(3),
    best_ask: (m + 0.005).toFixed(3),
    mid,
    spread_ticks: 1,
    features: {},
    signal: null,
    position: "0",
    limits: {
      max_position: "10",
      max_notional: "25",
      max_order_rate_per_sec: 5,
      remaining_daily_loss: "5",
      remaining_daily_notional: "1000",
    },
    allowed_actions: ["buy", "sell", "no_trade"],
    ...overrides,
  };
}
const LIMITS = req("1").limits;

/** Three in-hours mids one second apart: the next request, one second later, has a full window. */
async function warm(d: ExperimentalRuleDecider, mid = "16.00") {
  for (let i = 0; i < 3; i++) expect((await d.decide(req(mid))).decision.action).toBe("no_trade");
}

async function opened() {
  const d = new ExperimentalRuleDecider(config);
  await warm(d);
  expect((await d.decide(req("15.96"))).decision.action).toBe("buy"); // entry ask 15.965
  return d;
}

describe("ExperimentalRuleDecider", () => {
  it("loads the committed config and it is labelled experimental", () => {
    const cfg = loadRuleConfig();
    expect(cfg).toMatchObject({ entry_below_mean: "0.03", take_profit: "0.02", stop_loss: "0.04", tick_size: "0.01" });
    expect(cfg.window_seconds).toBeGreaterThan(0);
    expect(cfg.timeout_seconds).toBeGreaterThan(0);
    expect(cfg.max_gap_seconds).toBeGreaterThan(0);
  });

  it("holds until the window is full, then buys a dip at the ask", async () => {
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    expect((await d.decide(req("15.98"))).decision.action).toBe("no_trade"); // 2c below: not enough
    const { decision, raw } = await d.decide(req("15.96"));
    expect(decision).toMatchObject({ action: "buy", qty: "1", limit_price: "15.965" });
    expect(decision.rationale).toMatch(/EXPERIMENTAL.*entry: mid.*Exit plan.*Expected edge after spread/);
    expect(raw).toEqual({ experimental: true, rule: "experimental-rule:dip-reversion-test" });
  });

  it("sizes floor(max_notional / ask), capped by the request's notional and position room", async () => {
    const cheap = { ...config, max_notional: "100" };
    const buyQty = async (overrides: Partial<DecisionRequest>, cfg = cheap) => {
      const d = new ExperimentalRuleDecider(cfg);
      await warm(d, "5.00");
      return (await d.decide(req("4.96", overrides))).decision;
    };
    // ask 4.965: config 100 -> 20, request notional 25 -> 5 shares.
    expect((await buyQty({})).qty).toBe("5");
    expect((await buyQty({ limits: { ...LIMITS, max_notional: "1000", max_position: "50" } })).qty).toBe("20");
    expect((await buyQty({ limits: { ...LIMITS, max_notional: "1000", max_position: "3" } })).qty).toBe("3");
    // Notional smaller than one share: no trade, never a fractional share.
    expect((await buyQty({ limits: { ...LIMITS, max_notional: "4" } })).action).toBe("no_trade");
  });

  it("opens only when remaining_daily_notional covers the buy and its worst-case exit", async () => {
    const buy = async (limits: Partial<DecisionRequest["limits"]>, cfg: RuleConfig = config) => {
      const d = new ExperimentalRuleDecider(cfg);
      await warm(d);
      return (await d.decide(req("15.96", { limits: { ...LIMITS, ...limits } }))).decision;
    };
    // ask 15.965: one share needs 15.965 + (15.965 + 0.02) = 31.95 of room.
    expect((await buy({ remaining_daily_notional: "31.94" })).action).toBe("no_trade");
    expect(await buy({ remaining_daily_notional: "31.95" })).toMatchObject({ action: "buy", qty: "1" });
    const wide = { ...config, max_notional: "100" };
    expect(await buy({ max_notional: "100", remaining_daily_notional: "95.84" }, wide)).toMatchObject({ qty: "2" });
    expect(await buy({ max_notional: "100", remaining_daily_notional: "95.85" }, wide)).toMatchObject({ qty: "3" });
    // A bridge that does not report it (before protocol v1.3): no room, no entry.
    const { remaining_daily_notional: _omit, ...older } = LIMITS;
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    const none = (await d.decide(req("15.96", { limits: older }))).decision;
    expect(none.action).toBe("no_trade");
    expect(none.rationale).toMatch(/remaining_daily_notional/);
  });

  it("enters only on a one-tick book: bid < ask and ask - bid <= 0.01", async () => {
    const entry = async (bid: string, ask: string) => {
      const d = new ExperimentalRuleDecider(config);
      await warm(d);
      return (await d.decide(req("15.96", { best_bid: bid, best_ask: ask }))).decision;
    };
    expect((await entry("15.955", "15.965")).action).toBe("buy");
    expect((await entry("15.95", "15.97")).action).toBe("no_trade"); // two ticks
    expect((await entry("15.96", "15.96")).action).toBe("no_trade"); // locked
    expect((await entry("15.97", "15.95")).action).toBe("no_trade"); // crossed
  });

  it("does not buy when buy is not allowed", async () => {
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    expect((await d.decide(req("15.90", { allowed_actions: ["no_trade"] }))).decision.action).toBe("no_trade");
  });

  it("measures the window in ts_ns seconds, not request count", async () => {
    const d = new ExperimentalRuleDecider(config);
    // Ten requests 0.1 s apart span under 3 s: still warming up.
    for (let i = 0; i < 10; i++) await d.decide(req("16.00", { ts_ns: t + SEC / 10 }));
    const early = (await d.decide(req("15.96", { ts_ns: t + SEC / 10 }))).decision;
    expect(early.action).toBe("no_trade");
    expect(early.rationale).toMatch(/warming up/);
  });

  it("skips out-of-hours mids (no_trade-only requests) from the mean", async () => {
    const d = new ExperimentalRuleDecider(config);
    await d.decide(req("16.00"));
    await d.decide(req("15.00", { allowed_actions: ["no_trade"] }));
    await d.decide(req("15.00", { allowed_actions: ["no_trade"] }));
    await d.decide(req("16.00"));
    // Mean of the in-hours mids is 16.00, so 15.96 is a dip; with 15.00s counted it would not be.
    expect((await d.decide(req("15.96"))).decision.action).toBe("buy");
  });

  it("restarts the window after a gap longer than max_gap_seconds", async () => {
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    const after = (await d.decide(req("15.96", { ts_ns: t + 11 * SEC }))).decision;
    expect(after.action).toBe("no_trade");
    expect(after.rationale).toMatch(/warming up/);
  });

  it("takes profit at the bid once bid >= entry + 0.02", async () => {
    const d = await opened();
    expect((await d.decide(req("15.985", { position: "1" }))).decision.action).toBe("no_trade"); // bid 15.98
    const { decision } = await d.decide(req("15.99", { position: "1" })); // bid 15.985
    expect(decision).toMatchObject({ action: "sell", qty: "1", limit_price: "15.985" });
    expect(decision.rationale).toMatch(/take profit.*P&L after spread \$0.02/);
  });

  it("stops out at bid <= entry - 0.04", async () => {
    const d = await opened();
    const { decision } = await d.decide(req("15.93", { position: "1" })); // bid 15.925
    expect(decision).toMatchObject({ action: "sell", qty: "1" });
    expect(decision.rationale).toMatch(/stop/);
  });

  it("times out timeout_seconds after entry, however few requests arrived", async () => {
    const d = await opened();
    expect((await d.decide(req("15.97", { position: "1", ts_ns: t + 4 * SEC }))).decision.action).toBe("no_trade");
    const { decision } = await d.decide(req("15.97", { position: "1", ts_ns: t + 1 * SEC }));
    expect(decision.action).toBe("sell");
    expect(decision.rationale).toMatch(/timeout/);
  });

  it("stops re-proposing a closing sell the bridge rejected, and names the blocker", async () => {
    const d = await opened();
    (d as Decider).observe?.({ accepted: true, client_order_id: 1 });
    expect((await d.decide(req("16.10", { position: "1" }))).decision.action).toBe("sell");
    (d as Decider).observe?.({ accepted: false, risk_reject: "max_daily_notional" });
    for (let i = 0; i < 3; i++) {
      const { decision } = await d.decide(req("16.10", { position: "1" }));
      expect(decision.action).toBe("no_trade");
      expect(decision.rationale).toMatch(/blocked: closing sell rejected, max_daily_notional/);
      (d as Decider).observe?.(null);
    }
    // Once the position changes the block lifts.
    expect((await d.decide(req("16.10", { position: "2" }))).decision.action).toBe("sell");
  });

  it("stops re-proposing an accepted IOC that did not change the position", async () => {
    const d = await opened();
    (d as Decider).observe?.({ accepted: true, client_order_id: 1 });
    await d.decide(req("16.10", { position: "1" })); // sell proposed
    (d as Decider).observe?.({ accepted: true, client_order_id: 2 });
    const { decision } = await d.decide(req("16.10", { position: "1" }));
    expect(decision.action).toBe("no_trade");
    expect(decision.rationale).toMatch(/blocked: closing sell accepted but not filled/);
  });

  it("never sells more than it holds, and never sells when flat or short", async () => {
    const d = await opened();
    expect((await d.decide(req("16.10", { position: "2.5" }))).decision).toMatchObject({ action: "sell", qty: "2" });
    const flat = new ExperimentalRuleDecider(config);
    await warm(flat, "15.00"); // price only rises: no entry
    expect((await flat.decide(req("16.10"))).decision.action).toBe("no_trade");
    expect((await flat.decide(req("15.00", { position: "-1" }))).decision.action).toBe("no_trade");
    expect((await flat.decide(req("16.10", { position: "0.5" }))).decision.action).toBe("no_trade");
  });

  it("flags a position it did not open for a human and never sells it", async () => {
    const d = new ExperimentalRuleDecider(config);
    for (const mid of ["16.00", "15.00", "17.00"]) {
      const { decision } = await d.decide(req(mid, { position: "1" }));
      expect(decision.action).toBe("no_trade");
      expect(decision.rationale).toMatch(/HUMAN REVIEW.*did not open/);
    }
  });

  it("does not sell when sell is not allowed", async () => {
    const d = await opened();
    const { decision } = await d.decide(req("16.10", { position: "1", allowed_actions: ["no_trade"] }));
    expect(decision.action).toBe("no_trade");
  });
});
