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
import { pollBook, pollQuote } from "../../src/recorder/poll.js";
import { createMockRobinhoodServer } from "../../src/testkit/mock-robinhood-mcp.js";

const ORDER: ApprovedOrder = {
  client_order_id: 1,
  instrument: "SPY",
  side: "buy",
  qty: "1",
  limit_price: "20.00",
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
    expect(sample.bid).toBe("100.000000");
    expect(sample.ask).toBe("100.050000");
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

    await expect(placeOrder(client, "equity", "SYNTH0001", ORDER, "ref-1")).rejects.toThrow(OrderToolCalledError);
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
    await expect(placeOrder(client, "equity", "SYNTH0001", ORDER, "ref-1")).rejects.toThrow(OrderToolCalledError);
    await expect(placeOrder(client, "equity", "SYNTH0001", { ...ORDER, client_order_id: 2 }, "ref-2")).rejects.toThrow(OrderToolCalledError);

    expect(calledTools).toEqual(["get_equity_quotes", "get_equity_quotes", "get_equity_quotes", "get_equity_quotes", "get_equity_quotes"]);
    expect(calledTools.some((t) => t.includes("place") || t.includes("cancel"))).toBe(false);
  });

  it("polls a full Level 2 book through the wrapped client for equity", async () => {
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

    const book = await pollBook(client, "equity", "SPY");
    expect(book.depth).toBe("l2");
    expect(book.bids.length).toBeGreaterThan(1);
    expect(book.asks.length).toBeGreaterThan(1);
    expect(calledTools).toEqual(["get_equity_price_book"]);
  });

  it("falls back to a flagged top-of-book poll for equity when the real book comes back empty", async () => {
    const calledTools: string[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ emptyBook: true, onToolCall: (name) => calledTools.push(name) });
    await server.connect(serverTransport);
    const rawClient = await connectRobinhoodMcp({ transport: clientTransport });
    cleanup = async () => {
      await rawClient.close();
      await server.close();
    };

    const book = await pollBook(readOnly(rawClient), "equity", "SPY");
    expect(book.depth).toBe("top_of_book");
    expect(book.bids).toEqual([{ price: "100.000000" }]);
    expect(book.asks).toEqual([{ price: "100.050000" }]);
    expect(calledTools).toEqual(["get_equity_price_book", "get_equity_quotes"]);
  });

  it("falls back to a flagged top-of-book poll for crypto -- no L2 tool exists, and it never calls an order tool either", async () => {
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

    const book = await pollBook(client, "crypto", "BTC-USD");
    expect(book.depth).toBe("top_of_book");
    expect(book.bids).toEqual([{ price: "100.000000" }]);
    expect(book.asks).toEqual([{ price: "100.050000" }]);
    // Only the read-only quote tool was ever reached -- no attempt at a crypto price-book tool
    // (there isn't one) and no order tool.
    expect(calledTools).toEqual(["get_crypto_quotes"]);
  });
});
