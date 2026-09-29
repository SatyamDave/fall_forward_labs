// PR #107 review findings, one test each: a bridge restart reuses client_order_id 1, an approval
// that expires during the preview, a partial fill with malformed fill fields, the account number
// reaching the journal, logs or the reconcile status file, and a fill seen before an unconfirmed
// IOC cancel. The broker is a scripted in-process fake McpClient (synthetic responses only).
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ed25519PublicKeyFromRaw } from "../../src/broker/crypto.js";
import { BrokerGateway, GatewayRejection } from "../../src/broker/gateway.js";
import type { McpClient } from "../../src/broker/mcp-client.js";
import { reconcileWithBroker } from "../../src/broker/reconcile.js";
import { getOrderById } from "../../src/broker/robinhood.js";
import type { Approval, ApprovedOrder, BridgeReporter, ReportExecutionOp } from "../../src/broker/types.js";

const ACCOUNT = "SYNTHETICACCT42";
const NOW_NS = 1_767_571_200_000_000_000;

type Handler = (args: Record<string, unknown>) => unknown;
interface Call {
  name: string;
  args: Record<string, unknown>;
  timeout?: number;
}

const ok = (data: Record<string, unknown>) => ({ structuredContent: { data, guide: "SYNTHETIC" }, content: [] });
const toolError = (text: string) => ({ isError: true, content: [{ type: "text", text }] });

function fakeMcp(handlers: Record<string, Handler>, calls: Call[] = []): McpClient {
  return {
    connect: async () => {},
    close: async () => {},
    callTool: async (p: { name: string; arguments: Record<string, unknown> }, _schema: unknown, opts?: { timeout?: number }) => {
      calls.push({ name: p.name, args: p.arguments, timeout: opts?.timeout });
      const handler = handlers[p.name];
      if (!handler) throw new Error(`fake broker: no handler for ${p.name}`);
      return handler(p.arguments);
    },
  } as unknown as McpClient;
}

class Reporter implements BridgeReporter {
  readonly calls: ReportExecutionOp[] = [];
  async reportExecution(op: ReportExecutionOp) {
    this.calls.push(op);
    return { ok: true };
  }
  events() {
    return this.calls.map((c) => [c.execution.event, c.execution.qty, c.execution.price]);
  }
}

/** One simulated qc-bridge process: its own fresh Ed25519 key, as the real bridge mints per start. */
function bridgeSession() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key: KeyObject = ed25519PublicKeyFromRaw((publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32));
  const approve = (o: ApprovedOrder, expiresTsNs = NOW_NS + 5_000_000_000): Approval => {
    const payload = JSON.stringify({
      client_order_id: o.client_order_id,
      expires_ts_ns: expiresTsNs,
      instrument: o.instrument,
      limit_price: o.limit_price,
      qty: o.qty,
      request_id: o.request_id,
      side: o.side,
      time_in_force: o.time_in_force,
    });
    return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
  };
  const approveCancel = (clientOrderId: number): Approval => {
    const payload = JSON.stringify({ action: "cancel", client_order_id: clientOrderId, expires_ts_ns: NOW_NS + 5_000_000_000 });
    return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
  };
  return { key, approve, approveCancel };
}

function order(id: number, fields: Partial<ApprovedOrder> = {}): ApprovedOrder {
  return { client_order_id: id, instrument: "SPY", side: "buy", qty: "1", limit_price: "10.00", time_in_force: "gtc", request_id: `dr-${id}`, ...fields };
}

const tempPath = (name: string) => path.join(mkdtempSync(path.join(tmpdir(), "broker-review-")), name);

function gateway(opts: { mcp: McpClient; key: KeyObject; journalPath: string; reporter?: Reporter; clock?: { ns: number }; requestTimeoutMs?: number }) {
  const clock = opts.clock ?? { ns: NOW_NS };
  return new BrokerGateway({
    mcp: opts.mcp,
    reporter: opts.reporter ?? new Reporter(),
    approvalPublicKey: opts.key,
    accountNumber: ACCOUNT,
    now: () => clock.ns,
    requestTimeoutMs: opts.requestTimeoutMs ?? 100,
    iocCancelAfterMs: 1,
    journalPath: opts.journalPath,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("bridge restart: the journal keeps each bridge session's client_order_ids apart", () => {
  it("a new session's order 1 is sent and filled on its own, never answered with the previous session's order 1", async () => {
    const journalPath = tempPath("broker-journal.jsonl");
    const calls: Call[] = [];
    const place: Handler = (a) => ok({ id: `venue-${String(a.limit_price)}`, ref_id: a.ref_id, state: "filled", filled_quantity: "1", average_price: a.limit_price });
    const mcp = fakeMcp({ review_equity_order: () => ok({}), place_equity_order: place }, calls);

    const before = bridgeSession();
    const oldResult = await gateway({ mcp, key: before.key, journalPath }).submitOrder(order(1), before.approve(order(1)), "equity");
    const oldRefId = calls.find((c) => c.name === "place_equity_order")!.args.ref_id as string;

    // The bridge restarts: fresh key, next_client_id back at 0, so the next order is 1 again.
    const after = bridgeSession();
    const reporter = new Reporter();
    const restarted = gateway({ mcp, key: after.key, journalPath, reporter });
    const newOrder = order(1, { limit_price: "12.00", request_id: "dr-1-new-session" });
    calls.length = 0;

    const result = await restarted.submitOrder(newOrder, after.approve(newOrder), "equity");

    expect(oldResult.avg_price).toBe("10");
    expect(calls.filter((c) => c.name === "place_equity_order")).toHaveLength(1);
    expect(result).toMatchObject({ status: "filled", avg_price: "12" });
    expect(reporter.events()).toEqual([["filled", "1", "12"]]);
    // Reconciliation maps only the current session's ref_ids to client_order_ids.
    expect(restarted.clientOrderIdForRefId(oldRefId)).toBeNull();
    expect(restarted.clientOrderIdForRefId(calls.find((c) => c.name === "place_equity_order")!.args.ref_id as string)).toBe(1);
  });

  it("a previous session's unknown and open orders are neither resent nor cancellable under a new session's ids", async () => {
    const journalPath = tempPath("broker-journal.jsonl");
    const calls: Call[] = [];
    let placeBehaviour: "timeout" | "accept" = "timeout";
    const mcp = fakeMcp(
      {
        review_equity_order: () => ok({}),
        place_equity_order: (a) => {
          if (placeBehaviour === "timeout") throw new Error("synthetic transport timeout");
          return ok({ id: `venue-${String(a.ref_id)}`, ref_id: a.ref_id, state: "confirmed" });
        },
        get_equity_orders: () => ok({ orders: [] }),
        cancel_equity_order: () => ok({}),
      },
      calls,
    );

    const before = bridgeSession();
    const oldGateway = gateway({ mcp, key: before.key, journalPath });
    // Order 2: outcome unknown when the session ends (every send and lookup ambiguous).
    await expect(oldGateway.submitOrder(order(2), before.approve(order(2)), "equity")).rejects.toThrow(/outcome unknown/);
    // Order 3: a gtc order left open at the venue.
    placeBehaviour = "accept";
    await oldGateway.submitOrder(order(3), before.approve(order(3)), "equity");
    const oldRefIds = new Set(calls.filter((c) => c.name === "place_equity_order").map((c) => c.args.ref_id));

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = bridgeSession();
    const restarted = gateway({ mcp, key: after.key, journalPath });
    // Visible, never matched: the startup log names both, and neither maps to a client_order_id.
    expect(logged.mock.calls.flat().join(" ")).toMatch(/2 order\(s\) from earlier bridge sessions/);
    for (const refId of oldRefIds) expect(restarted.clientOrderIdForRefId(refId as string)).toBeNull();
    calls.length = 0;

    // A cancel approval for the new session's order 3 never reaches the old session's order 3.
    await expect(restarted.cancelOrder(3, "SPY", "equity", after.approveCancel(3))).rejects.toThrow(GatewayRejection);
    expect(calls).toEqual([]);

    // The new session's order 2 is a first send under its own ref_id, not a lookup-and-resend of the old one.
    const newOrder = order(2, { request_id: "dr-2-new-session" });
    await restarted.submitOrder(newOrder, after.approve(newOrder), "equity");
    const names = calls.map((c) => c.name);
    expect(names).toEqual(["review_equity_order", "place_equity_order"]);
    expect(oldRefIds.has(calls[1]!.args.ref_id)).toBe(false);
  });
});

describe("approval expiry around the preview", () => {
  it("does not send when the approval expired while the preview ran", async () => {
    const journalPath = tempPath("broker-journal.jsonl");
    const calls: Call[] = [];
    const clock = { ns: NOW_NS };
    const session = bridgeSession();
    const mcp = fakeMcp(
      {
        review_equity_order: () => {
          clock.ns += 6_000_000_000; // a slow preview outlives the 5 s approval
          return ok({});
        },
        place_equity_order: (a) => ok({ id: "v", ref_id: a.ref_id, state: "confirmed" }),
      },
      calls,
    );
    const g = gateway({ mcp, key: session.key, journalPath, clock });

    await expect(g.submitOrder(order(1), session.approve(order(1)), "equity")).rejects.toThrow(/approval expired before the order could be sent/);
    expect(calls.map((c) => c.name)).toEqual(["review_equity_order"]);
    // Nothing was sent, so nothing is journaled as sent.
    expect(() => readFileSync(journalPath, "utf8")).toThrow();
  });

  it("gives the preview a shorter timeout than a place call", async () => {
    const calls: Call[] = [];
    const session = bridgeSession();
    const mcp = fakeMcp(
      { review_equity_order: () => ok({}), place_equity_order: (a) => ok({ id: "v", ref_id: a.ref_id, state: "filled", filled_quantity: "1", average_price: "10" }) },
      calls,
    );
    await gateway({ mcp, key: session.key, journalPath: tempPath("j.jsonl"), requestTimeoutMs: 5_000 }).submitOrder(order(1), session.approve(order(1)), "equity");

    expect(calls.map((c) => [c.name, c.timeout])).toEqual([
      ["review_equity_order", 1_000],
      ["place_equity_order", 5_000],
    ]);
  });
});

describe("fill fields on any order state", () => {
  const read = (entry: Record<string, unknown>) => getOrderById(fakeMcp({ get_equity_orders: () => ok({ orders: [{ id: "v", ...entry }] }) }), "equity", ACCOUNT, "v");

  it("throws for a cancelled order whose fill fields are not strings, instead of dropping the fill", async () => {
    await expect(read({ state: "cancelled", filled_quantity: "1", average_price: 10.0 })).rejects.toThrow(/average_price is a number/);
    await expect(read({ state: "cancelled", filled_quantity: 1, average_price: "10" })).rejects.toThrow(/filled_quantity is a number/);
  });

  it("throws for a nonzero filled_quantity with no average_price, in any state", async () => {
    await expect(read({ state: "cancelled", filled_quantity: "1" })).rejects.toThrow(/no average_price/);
    await expect(read({ state: "confirmed", filled_quantity: "1", average_price: null })).rejects.toThrow(/no average_price/);
  });

  it("still reads an unfilled order whose fill fields are absent, null or zero", async () => {
    await expect(read({ state: "cancelled", filled_quantity: "0", average_price: null })).resolves.toMatchObject({ status: "canceled", filled_qty: "0" });
    await expect(read({ state: "confirmed" })).resolves.toMatchObject({ status: "accepted", filled_qty: undefined });
  });
});

describe("the account number never leaves the order path", () => {
  it("is not journaled when a venue response echoes it", async () => {
    const journalPath = tempPath("broker-journal.jsonl");
    const session = bridgeSession();
    const mcp = fakeMcp({
      review_equity_order: () => ok({}),
      place_equity_order: (a) =>
        ok({ id: "v", ref_id: a.ref_id, state: "filled", filled_quantity: "1", average_price: "10", account_number: a.account_number, account: `https://api.example.test/accounts/${ACCOUNT}/` }),
    });
    const result = await gateway({ mcp, key: session.key, journalPath }).submitOrder(order(1), session.approve(order(1)), "equity");

    expect(result.status).toBe("filled");
    expect(readFileSync(journalPath, "utf8")).not.toContain(ACCOUNT);
  });

  it("is removed from a tool error before the gateway logs it", async () => {
    const session = bridgeSession();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mcp = fakeMcp({
      review_equity_order: () => ok({}),
      place_equity_order: (a) => toolError(`account ${String(a.account_number)} is not permitted`),
      get_equity_orders: () => toolError(`account ${ACCOUNT}: lookup refused`),
    });
    const g = gateway({ mcp, key: session.key, journalPath: tempPath("j.jsonl") });

    const failure = await g.submitOrder(order(1), session.approve(order(1)), "equity").catch((err: Error) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(ACCOUNT);
    expect(`${(failure as Error).message} ${(failure as Error).stack}`).not.toContain(ACCOUNT);
    expect((failure as Error).message).toContain("<account>");
  });

  it("is removed from a broker error before reconcile writes the status file", async () => {
    const statusPath = tempPath("reconcile-status.json");
    const mcp = fakeMcp({
      get_equity_orders: () => toolError(`account ${ACCOUNT} is not permitted`),
      get_equity_positions: () => ok({ positions: [] }),
      get_accounts: () => ok({ accounts: [{ account_number: ACCOUNT, agentic_allowed: true, deactivated: false, permanently_deactivated: false }] }),
    });
    const bridge = { reconcile: async () => ({ ok: true, reconcile: { ok: true, discrepancies: [] } }) };

    await expect(
      reconcileWithBroker({ mcp, bridge, assetClass: "equity", accountNumber: ACCOUNT, instrument: "SPY", clientOrderIdForRefId: () => null, statusPath }),
    ).rejects.toThrow(/<account> is not permitted/);
    const status = readFileSync(statusPath, "utf8");
    expect(JSON.parse(status).ok).toBe(false);
    expect(status).not.toContain(ACCOUNT);
  });
});

describe("emulated IOC whose cancel cannot be confirmed", () => {
  it("reports the fill it last read back before throwing, and only the rest afterwards", async () => {
    const session = bridgeSession();
    const reporter = new Reporter();
    let cancelTakes = false;
    const mcp = fakeMcp({
      review_equity_order: () => ok({}),
      place_equity_order: (a) => ok({ id: "v-ioc", ref_id: a.ref_id, state: "confirmed" }),
      cancel_equity_order: () => ok({}),
      get_equity_orders: () =>
        ok({ orders: [{ id: "v-ioc", state: cancelTakes ? "cancelled" : "partially_filled", filled_quantity: "1", average_price: "10.00" }] }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const g = gateway({ mcp, key: session.key, journalPath: tempPath("j.jsonl"), reporter });
    const ioc = order(1, { qty: "2", time_in_force: "ioc" });

    await expect(g.submitOrder(ioc, session.approve(ioc), "equity")).rejects.toThrow(/cancel not confirmed/);
    expect(reporter.events()).toEqual([
      ["accepted", undefined, undefined],
      ["partially_filled", "1", "10"],
    ]);

    // A halt's cancel later takes: the fill already reported is not reported again.
    cancelTakes = true;
    await expect(g.cancelOrder(1, "SPY", "equity", session.approveCancel(1))).resolves.toMatchObject({ status: "canceled" });
    expect(reporter.events().slice(2)).toEqual([["canceled", undefined, undefined]]);
  }, 10_000);
});
