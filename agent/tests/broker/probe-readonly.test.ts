// `just robinhood-probe-readonly` (#26): only the five read-only tools, response shapes with
// every value redacted, and last-trade prices, against the mock Robinhood MCP server.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { allowOnly, connectRobinhoodMcp, OrderToolCalledError } from "../../src/broker/mcp-client.js";
import { DEFAULT_PROBE_SYMBOLS, lastTradePrices, parseProbeArgs, runProbe, shapeOf } from "../../src/broker/probe-readonly.js";
import { PROBE_TOOLS, probeCalls } from "../../src/broker/robinhood.js";
import { createMockRobinhoodServer, MOCK_ACCOUNT_NUMBER } from "../../src/testkit/mock-robinhood-mcp.js";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function connected(calls: string[]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMockRobinhoodServer({ onToolCall: (name) => calls.push(name) });
  await server.connect(serverTransport);
  const client = await connectRobinhoodMcp({ transport: clientTransport });
  cleanup = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

describe("robinhood read-only probe", () => {
  it("allows exactly the five read-only tools, and every planned call is one of them", () => {
    expect([...PROBE_TOOLS].sort()).toEqual([
      "get_accounts",
      "get_equity_orders",
      "get_equity_positions",
      "get_equity_price_book",
      "get_equity_quotes",
    ]);
    for (const call of probeCalls("A", DEFAULT_PROBE_SYMBOLS)) expect(PROBE_TOOLS.has(call.tool)).toBe(true);
  });

  it("splits the price book into calls of at most 4 symbols (the tool's limit)", () => {
    const books = probeCalls("A", DEFAULT_PROBE_SYMBOLS).filter((c) => c.tool === "get_equity_price_book");
    expect(books.map((c) => (c.args.symbols as string[]).length)).toEqual([4, 1]);
  });

  it("refuses an order, cancel or preview tool before it reaches the wire", async () => {
    const calls: string[] = [];
    const client = allowOnly(await connected(calls), PROBE_TOOLS);
    for (const name of ["place_equity_order", "cancel_equity_order", "review_equity_order", "place_crypto_order"]) {
      await expect(client.callTool({ name, arguments: {} })).rejects.toThrow(OrderToolCalledError);
    }
    expect(calls).toEqual([]);
  });

  it("calls only the allowlisted tools and records shapes with no values", async () => {
    const calls: string[] = [];
    const client = await connected(calls);
    const result = await runProbe(client, MOCK_ACCOUNT_NUMBER, ["SPY", "SPLG"]);

    expect(result.failures).toBe(0);
    expect(new Set(calls)).toEqual(PROBE_TOOLS);
    const written = JSON.stringify(result.shapes);
    expect(written).not.toContain(MOCK_ACCOUNT_NUMBER);
    expect(written).not.toContain("10000");
    expect(written).not.toContain("100.0");
    expect(result.shapes.find((s) => s.tool === "get_accounts")!.shape).toEqual({
      accounts: [{ account_number: "string", agentic_allowed: "boolean", cash: "string" }],
    });
    expect(result.prices).toEqual(new Map([["SPY", "100.02"], ["SPLG", "100.02"]]));
  });

  it("redacts keys that could be data, and never keeps array lengths", () => {
    const shape = shapeOf({ ACCT1: { n: 1 }, "12345678": true, list: [1, 2, 3, "x"], ok: null }, new Set(["ACCT1"]));
    expect(shape).toEqual({ "<redacted-key-1>": "boolean", "<redacted-key-2>": { n: "number" }, list: ["number", "string"], ok: "null" });
  });

  it("reports a missing price instead of guessing", () => {
    expect(lastTradePrices({ quotes: [{ symbol: "SPY", last: "1" }] }, ["SPY"]).get("SPY")).toMatch(/not found/);
    expect(lastTradePrices(undefined, ["SPY"]).get("SPY")).toMatch(/not found/);
  });

  it("defaults to the mock and the candidate symbols; rejects anything else", () => {
    expect(parseProbeArgs([])).toEqual({ target: "mock", symbols: DEFAULT_PROBE_SYMBOLS });
    expect(parseProbeArgs(["--target", "real", "--symbols", "SPY,SCHB"])).toEqual({ target: "real", symbols: ["SPY", "SCHB"] });
    expect(() => parseProbeArgs(["--symbols", "spy;rm"])).toThrow(/usage/);
    expect(() => parseProbeArgs(["--place"])).toThrow(/usage/);
  });
});
