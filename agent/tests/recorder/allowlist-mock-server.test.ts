// End-to-end proof over the real MCP wire protocol (same pattern as
// agent/tests/broker/robinhood.test.ts): a quote poll through readOnly() succeeds against the
// mock Robinhood server, and an attempted order call throws before the mock server's
// onToolCall hook ever sees the tool name -- i.e. it never reaches the wire, not just that the
// call eventually errors out.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { placeOrder } from "../../src/broker/robinhood.js";
import type { ApprovedOrder } from "../../src/broker/types.js";
import { OrderToolCalledError, readOnly } from "../../src/recorder/allowlist.js";
import { pollQuote } from "../../src/recorder/poll.js";
import { createMockRobinhoodServer } from "../../src/testkit/mock-robinhood-mcp.js";

const ORDER: ApprovedOrder = {
  client_order_id: 1,
  instrument: "SPY",
  side: "buy",
  qty: "10",
  limit_price: "500.00",
  time_in_force: "ioc",
  request_id: "req-1",
};

describe("recorder allowlist against the mock Robinhood MCP server", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("polls a quote through the wrapped client", async () => {
    const calledTools: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ onToolCall: (name) => calledTools.push(name) });
    await server.connect(serverTransport);
    const rawClient = await connectRobinhoodMcp({ transport: clientTransport });
    cleanup = async () => {
      await rawClient.close();
      await server.close();
    };
    const client = readOnly(rawClient);

    const sample = await pollQuote(client, "equity", "SPY");
    expect(sample.bid).toBe("100.00");
    expect(sample.ask).toBe("100.05");
    expect(calledTools).toEqual(["get_equity_quotes"]);
  });

  it("never lets an order tool reach the mock server -- readOnly() rejects it first", async () => {
    const calledTools: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ onToolCall: (name) => calledTools.push(name) });
    await server.connect(serverTransport);
    const rawClient = await connectRobinhoodMcp({ transport: clientTransport });
    cleanup = async () => {
      await rawClient.close();
      await server.close();
    };
    const client = readOnly(rawClient);

    await expect(placeOrder(client, "equity", ORDER)).rejects.toThrow(OrderToolCalledError);
    // The whole point: the mock server's handler (and its onToolCall hook) never ran for
    // place_equity_order -- the rejection happened inside readOnly(), before the wire.
    expect(calledTools).toEqual([]);
  });

  it("polling many times and then attempting an order still only ever calls quote tools", async () => {
    const calledTools: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ onToolCall: (name) => calledTools.push(name) });
    await server.connect(serverTransport);
    const rawClient = await connectRobinhoodMcp({ transport: clientTransport });
    cleanup = async () => {
      await rawClient.close();
      await server.close();
    };
    const client = readOnly(rawClient);

    for (let i = 0; i < 5; i++) {
      await pollQuote(client, "equity", "SPY");
    }
    await expect(placeOrder(client, "equity", ORDER)).rejects.toThrow(OrderToolCalledError);
    await expect(placeOrder(client, "equity", { ...ORDER, client_order_id: 2 })).rejects.toThrow(OrderToolCalledError);

    expect(calledTools).toEqual(["get_equity_quotes", "get_equity_quotes", "get_equity_quotes", "get_equity_quotes", "get_equity_quotes"]);
    expect(calledTools.some((t) => t.includes("place") || t.includes("cancel"))).toBe(false);
  });
});
