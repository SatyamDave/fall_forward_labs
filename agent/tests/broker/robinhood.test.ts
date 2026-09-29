// Exercises agent/src/broker/robinhood.ts (the ONE tool-name/parameter mapping module) against
// the mock Robinhood MCP server (agent/src/testkit/mock-robinhood-mcp.ts) over a real MCP
// client/server handshake. The mock serves the real input schemas (docs/research/
// robinhood-tools-2026-09-29.json) and refuses any call that does not satisfy them.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import {
  accountNumberFromEnv,
  BookUnsupportedError,
  cancelOrder,
  findOrderByRefId,
  getBook,
  getOrderById,
  orderRefusal,
  placeOrder,
  previewOrder,
  refIdForApproval,
  RobinhoodToolError,
  UnsupportedAssetClassError,
  verifyAgenticAccount,
} from "../../src/broker/robinhood.js";
import type { ApprovedOrder } from "../../src/broker/types.js";
import { createMockRobinhoodServer, MOCK_ACCOUNT_NUMBER, type MockRobinhoodOptions } from "../../src/testkit/mock-robinhood-mcp.js";

const ACCOUNT = MOCK_ACCOUNT_NUMBER;
// $20 notional: inside the $25/order max_notional (config/limits, #106).
const ORDER: ApprovedOrder = {
  client_order_id: 1,
  instrument: "SPY",
  side: "buy",
  qty: "1.00000000",
  limit_price: "20.00000000",
  time_in_force: "ioc",
  request_id: "req-1",
};
const REF = refIdForApproval('{"client_order_id":1}');

type Call = { name: string; args: Record<string, unknown> };

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function connected(opts: MockRobinhoodOptions = {}, calls: Call[] = []) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMockRobinhoodServer({ ...opts, onToolCall: (name, args) => calls.push({ name, args }) });
  await server.connect(serverTransport);
  const client = await connectRobinhoodMcp({ transport: clientTransport });
  cleanup = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

describe("robinhood.ts against the mock MCP server", () => {
  it("places a whole-share gfd limit order with the real parameter names, never a market order", async () => {
    const calls: Call[] = [];
    const client = await connected({ scenarios: { "1": "accepted" } }, calls);
    const result = await placeOrder(client, "equity", ACCOUNT, ORDER, REF);
    expect(result.status).toBe("accepted");
    expect(result.venue_order_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]!.args).toEqual({
      account_number: ACCOUNT,
      symbol: "SPY",
      side: "buy",
      type: "limit",
      quantity: "1",
      limit_price: "20",
      time_in_force: "gfd",
      market_hours: "regular_hours",
      ref_id: REF,
    });
  });

  it("sends an approved gtc order as gtc", async () => {
    const calls: Call[] = [];
    const client = await connected({}, calls);
    await placeOrder(client, "equity", ACCOUNT, { ...ORDER, time_in_force: "gtc" }, REF);
    expect(calls[0]!.args.time_in_force).toBe("gtc");
  });

  it("refuses fractional shares and off-tick prices before any call", async () => {
    const calls: Call[] = [];
    const client = await connected({}, calls);
    expect(orderRefusal({ ...ORDER, qty: "0.5" })).toMatch(/whole number/);
    expect(orderRefusal({ ...ORDER, qty: "0" })).toMatch(/whole number/);
    expect(orderRefusal({ ...ORDER, limit_price: "20.001" })).toMatch(/tick/);
    expect(orderRefusal({ ...ORDER, limit_price: "0.5001" })).toBeUndefined();
    await expect(placeOrder(client, "equity", ACCOUNT, { ...ORDER, qty: "0.5" }, REF)).rejects.toThrow(/whole number/);
    expect(calls).toEqual([]);
  });

  it("maps no crypto order tool: a crypto order fails closed before any call", async () => {
    const calls: Call[] = [];
    const client = await connected({}, calls);
    await expect(placeOrder(client, "crypto", ACCOUNT, { ...ORDER, instrument: "BTC-USD" }, REF)).rejects.toThrow(UnsupportedAssetClassError);
    expect(calls).toEqual([]);
  });

  it("normalizes a partial fill", async () => {
    const client = await connected({ scenarios: { "1": "partially_filled" } });
    const result = await placeOrder(client, "equity", ACCOUNT, { ...ORDER, qty: "1" }, REF);
    expect(result.status).toBe("partially_filled");
    expect(result.filled_qty).toBe("0.5");
  });

  it("normalizes an explicit rejection with a reason, without throwing", async () => {
    const client = await connected({ scenarios: { "1": "rejected" } });
    const result = await placeOrder(client, "equity", ACCOUNT, ORDER, REF);
    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/SYNTHETIC/);
  });

  it("throws RobinhoodToolError on an unrecognized broker state, rather than guessing", async () => {
    const client = await connected({ scenarios: { "1": "ambiguous" } });
    await expect(placeOrder(client, "equity", ACCOUNT, ORDER, REF)).rejects.toThrow(RobinhoodToolError);
  });

  it("times out against a broker that never responds", async () => {
    const client = await connected({ scenarios: { "1": "timeout" } });
    await expect(placeOrder(client, "equity", ACCOUNT, ORDER, REF, { timeoutMs: 100 })).rejects.toThrow();
  });

  it("previews through review_equity_order without a ref_id (its schema has none)", async () => {
    const calls: Call[] = [];
    const client = await connected({}, calls);
    const preview = await previewOrder(client, "equity", ACCOUNT, ORDER);
    expect(preview.warnings.length).toBeGreaterThan(0);
    expect(calls[0]!.name).toBe("review_equity_order");
    expect(calls[0]!.args).not.toHaveProperty("ref_id");
  });

  it("looks orders up by venue order id and by ref_id", async () => {
    const client = await connected({ scenarios: { "1": "filled" } });
    expect((await getOrderById(client, "equity", ACCOUNT, "00000000-0000-4000-8000-000000000009")).status).toBe("not_found");
    const placed = await placeOrder(client, "equity", ACCOUNT, ORDER, REF);
    expect((await getOrderById(client, "equity", ACCOUNT, placed.venue_order_id!)).status).toBe("filled");
    expect((await findOrderByRefId(client, "equity", ACCOUNT, REF, "SPY", "2026-09-28"))?.venue_order_id).toBe(placed.venue_order_id);
    expect(await findOrderByRefId(client, "equity", ACCOUNT, "some-other-ref", "SPY", "2026-09-28")).toBeUndefined();
  });

  it("cancels by account_number + order_id", async () => {
    const calls: Call[] = [];
    const client = await connected({ scenarios: { "1": "accepted" } }, calls);
    const placed = await placeOrder(client, "equity", ACCOUNT, ORDER, REF);
    await cancelOrder(client, "equity", ACCOUNT, placed.venue_order_id!);
    expect(calls.at(-1)).toEqual({ name: "cancel_equity_order", args: { account_number: ACCOUNT, order_id: placed.venue_order_id } });
    expect((await getOrderById(client, "equity", ACCOUNT, placed.venue_order_id!)).status).toBe("canceled");
  });

  it("ref_id is a UUID determined by the approval payload alone", () => {
    expect(refIdForApproval('{"a":1}')).toBe(refIdForApproval('{"a":1}'));
    expect(refIdForApproval('{"a":1}')).not.toBe(refIdForApproval('{"a":2}'));
    expect(refIdForApproval('{"a":1}')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("gets a Level 2 book for an equity instrument through get_equity_price_book", async () => {
    const client = await connected();
    const book = await getBook(client, "equity", "SPY");
    expect(book.bids[0]).toEqual({ price: "99.99", qty: "500" });
    expect(book.asks[0]).toEqual({ price: "100.05", qty: "400" });
  });

  it("throws BookUnsupportedError for crypto -- no L2 tool is mapped for that asset class", async () => {
    const client = await connected();
    await expect(getBook(client, "crypto", "BTC-USD")).rejects.toThrow(BookUnsupportedError);
  });
});

describe("the trading account", () => {
  it("refuses to start without QC_ROBINHOOD_ACCOUNT_NUMBER, and never echoes a malformed value", () => {
    expect(() => accountNumberFromEnv({})).toThrow(/QC_ROBINHOOD_ACCOUNT_NUMBER is not set/);
    expect(() => accountNumberFromEnv({ QC_ROBINHOOD_ACCOUNT_NUMBER: "" })).toThrow(/not set/);
    expect(() => accountNumberFromEnv({ QC_ROBINHOOD_ACCOUNT_NUMBER: "12 34;x" })).toThrow(/^(?!.*12 34).*alphanumeric/);
    expect(accountNumberFromEnv({ QC_ROBINHOOD_ACCOUNT_NUMBER: "5QR12345" })).toBe("5QR12345");
  });

  it("accepts an agentic account", async () => {
    const client = await connected();
    await expect(verifyAgenticAccount(client, ACCOUNT)).resolves.toMatchObject({ agentic_allowed: true });
  });

  it("refuses a non-agentic account", async () => {
    const client = await connected({ accounts: [{ account_number: ACCOUNT, agentic_allowed: false }] });
    await expect(verifyAgenticAccount(client, ACCOUNT)).rejects.toThrow(/agentic_allowed=true/);
  });

  it("refuses when agentic_allowed is not the boolean true", async () => {
    const client = await connected({ accounts: [{ account_number: ACCOUNT, agentic_allowed: "true" }] });
    await expect(verifyAgenticAccount(client, ACCOUNT)).rejects.toThrow(/agentic_allowed=true/);
  });

  it("refuses an account get_accounts does not list, without naming it", async () => {
    const client = await connected({ accounts: [{ account_number: "OTHER1", agentic_allowed: true }] });
    await expect(verifyAgenticAccount(client, ACCOUNT)).rejects.toThrow(/^(?!.*SYNTH0001).*is not among the 1 account/);
  });

  it("fails closed on an unexpected get_accounts shape", async () => {
    const client = await connected({ accounts: { not: "a list" } as unknown as Array<Record<string, unknown>> });
    await expect(verifyAgenticAccount(client, ACCOUNT)).rejects.toThrow(RobinhoodToolError);
  });
});
