// Exercises agent/src/broker/robinhood.ts (the ONE tool-name/parameter mapping module) against
// the mock Robinhood MCP server (agent/src/testkit/mock-robinhood-mcp.ts) over a real MCP
// client/server handshake -- an InMemoryTransport pair, so the wire protocol is real even
// though the "broker" on the other end is synthetic.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { BookUnsupportedError, RobinhoodToolError, cancelOrder, getBook, getOrderStatus, placeOrder, previewOrder } from "../../src/broker/robinhood.js";
import type { ApprovedOrder } from "../../src/broker/types.js";
import { createMockRobinhoodServer, type MockScenario } from "../../src/testkit/mock-robinhood-mcp.js";

const ORDER: ApprovedOrder = {
  client_order_id: 1,
  instrument: "SPY",
  side: "buy",
  qty: "10",
  limit_price: "500.00",
  time_in_force: "ioc",
  request_id: "req-1",
};

async function connected(scenarios: Record<string, MockScenario>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMockRobinhoodServer({ scenarios });
  await server.connect(serverTransport);
  const client = await connectRobinhoodMcp({ transport: clientTransport });
  return { client, server };
}

describe("robinhood.ts against the mock MCP server", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("places an equity order through place_equity_order and normalizes an accepted state", async () => {
    const { client, server } = await connected({ "1": "accepted" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const result = await placeOrder(client, "equity", ORDER);
    expect(result.status).toBe("accepted");
    // Decimal (not "SYN-1"): the real bridge's wire::parse_venue_order_id requires a
    // decimal-integer string (wave-2 review/integration finding; see mock-robinhood-mcp.ts).
    expect(result.venue_order_id).toBe("900001");
  });

  it("routes crypto orders through the crypto tool names, not the equity ones", async () => {
    const { client, server } = await connected({ "1": "filled" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const result = await placeOrder(client, "crypto", { ...ORDER, instrument: "BTC-USD" });
    expect(result.status).toBe("filled");
  });

  it("normalizes a partial fill", async () => {
    const { client, server } = await connected({ "1": "partially_filled" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const result = await placeOrder(client, "equity", ORDER);
    expect(result.status).toBe("partially_filled");
    expect(result.filled_qty).toBe("5");
  });

  it("normalizes an explicit rejection with a reason, without throwing", async () => {
    const { client, server } = await connected({ "1": "rejected" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const result = await placeOrder(client, "equity", ORDER);
    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/SYNTHETIC/);
  });

  it("throws RobinhoodToolError on an ambiguous/unrecognized broker state, rather than guessing", async () => {
    const { client, server } = await connected({ "1": "ambiguous" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    await expect(placeOrder(client, "equity", ORDER)).rejects.toThrow(RobinhoodToolError);
  });

  it("times out against a broker that never responds", async () => {
    const { client, server } = await connected({ "1": "timeout" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    await expect(placeOrder(client, "equity", ORDER, { timeoutMs: 100 })).rejects.toThrow();
  });

  it("calls the preview tool before a real caller would place the order", async () => {
    const { client, server } = await connected({});
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const preview = await previewOrder(client, "equity", ORDER);
    expect(preview.warnings.length).toBeGreaterThan(0);
  });

  it("looks up order status by client_order_id and reports not_found for an unplaced id", async () => {
    const { client, server } = await connected({});
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const status = await getOrderStatus(client, "equity", 999);
    expect(status.status).toBe("not_found");
  });

  it("looks up order status for a placed order", async () => {
    const { client, server } = await connected({ "1": "filled" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    await placeOrder(client, "equity", ORDER);
    const status = await getOrderStatus(client, "equity", 1);
    expect(status.status).toBe("filled");
  });

  it("cancels an order", async () => {
    const { client, server } = await connected({ "1": "canceled" });
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const result = await cancelOrder(client, "equity", 1, "SPY");
    expect(result.status).toBe("canceled");
  });

  it("gets a Level 2 book for an equity instrument through get_equity_price_book", async () => {
    const { client, server } = await connected({});
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    const book = await getBook(client, "equity", "SPY");
    expect(book.bids[0]).toEqual({ price: "99.99", qty: "500" });
    expect(book.bids.length).toBeGreaterThan(1);
    expect(book.asks[0]).toEqual({ price: "100.05", qty: "400" });
    expect(book.asks.length).toBeGreaterThan(1);
  });

  it("throws BookUnsupportedError for crypto -- no L2 tool is mapped for that asset class", async () => {
    const { client, server } = await connected({});
    cleanup = async () => {
      await client.close();
      await server.close();
    };
    await expect(getBook(client, "crypto", "BTC-USD")).rejects.toThrow(BookUnsupportedError);
  });
});
