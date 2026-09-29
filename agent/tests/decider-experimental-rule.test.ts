import { describe, expect, it } from "vitest";
import { ExperimentalRuleDecider, loadRuleConfig, type RuleConfig } from "../src/decider/experimental-rule.js";
import type { DecisionRequest } from "../src/types.js";

const config: RuleConfig = {
  name: "dip-reversion",
  version: "test",
  window: 3,
  entry_below_mean: "0.03",
  take_profit: "0.02",
  stop_loss: "0.04",
  timeout: 5,
  max_notional: "25",
};

let n = 0;
/** A one-cent-wide book around `mid`. */
function req(mid: string, overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  const m = Number(mid);
  return {
    request_id: `r-${++n}`,
    ts_ns: n,
    instrument: "SOFI",
    best_bid: (m - 0.005).toFixed(3),
    best_ask: (m + 0.005).toFixed(3),
    mid,
    spread_ticks: 1,
    features: {},
    signal: null,
    position: "0",
    limits: { max_position: "10", max_notional: "25", max_order_rate_per_sec: 5, remaining_daily_loss: "5" },
    allowed_actions: ["buy", "sell", "no_trade"],
    ...overrides,
  };
}

async function warm(d: ExperimentalRuleDecider, mid = "16.00") {
  for (let i = 0; i < config.window; i++) expect((await d.decide(req(mid))).decision.action).toBe("no_trade");
}

describe("ExperimentalRuleDecider", () => {
  it("loads the committed config and it is labelled experimental", () => {
    const cfg = loadRuleConfig();
    expect(cfg).toMatchObject({ window: 300, entry_below_mean: "0.03", take_profit: "0.02", stop_loss: "0.04", timeout: 600 });
  });

  it("holds until the window is full, then buys a dip at the ask", async () => {
    const d = new ExperimentalRuleDecider(config);
    expect((await d.decide(req("15.90"))).decision.action).toBe("no_trade"); // warming up
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
    expect((await buyQty({ limits: { ...req("1").limits, max_notional: "1000", max_position: "50" } })).qty).toBe("20");
    expect((await buyQty({ limits: { ...req("1").limits, max_notional: "1000", max_position: "3" } })).qty).toBe("3");
    // Notional smaller than one share: no trade, never a fractional share.
    expect((await buyQty({ limits: { ...req("1").limits, max_notional: "4" } })).action).toBe("no_trade");
  });

  it("does not buy when buy is not allowed", async () => {
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    expect((await d.decide(req("15.90", { allowed_actions: ["no_trade"] }))).decision.action).toBe("no_trade");
  });

  async function opened() {
    const d = new ExperimentalRuleDecider(config);
    await warm(d);
    expect((await d.decide(req("15.96"))).decision.action).toBe("buy"); // entry ask 15.965
    return d;
  }

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

  it("times out after `timeout` requests held", async () => {
    const d = await opened();
    for (let i = 1; i < config.timeout; i++) {
      expect((await d.decide(req("15.97", { position: "1" }))).decision.action).toBe("no_trade");
    }
    const { decision } = await d.decide(req("15.97", { position: "1" }));
    expect(decision.action).toBe("sell");
    expect(decision.rationale).toMatch(/timeout/);
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

  it("flattens a position it did not open", async () => {
    const d = new ExperimentalRuleDecider(config);
    const { decision } = await d.decide(req("16.00", { position: "1" }));
    expect(decision).toMatchObject({ action: "sell", qty: "1" });
    expect(decision.rationale).toMatch(/not opened by this rule/);
  });

  it("does not sell when sell is not allowed", async () => {
    const d = await opened();
    const { decision } = await d.decide(req("16.10", { position: "1", allowed_actions: ["no_trade"] }));
    expect(decision.action).toBe("no_trade");
  });
});
