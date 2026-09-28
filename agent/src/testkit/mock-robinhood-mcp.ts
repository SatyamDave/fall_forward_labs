// Mock Robinhood Agentic Trading MCP server (issues #35, #43): synthetic, clearly labelled
// responses over a real MCP server/client handshake, so agent/src/broker/robinhood.ts and
// mcp-client.ts are exercised through the real @modelcontextprotocol/sdk wire protocol, never a
// hand-rolled stand-in. No network call and no real Robinhood connection -- hard limit.
//
// This is deliberately NOT agent/src/testkit/fake-bridge.ts (that file fakes qc-bridge, a
// different lane's shared file, over a different transport). This fakes Robinhood, over MCP.
//
// Tool names match robinhood-agentic-mcp.md §2's published table; response *shapes* are this
// testkit's own synthetic fixtures (real parameter/response schemas are UNVERIFIED until #26 --
// see agent/src/broker/robinhood.ts's header).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type MockScenario =
  | "accepted" // place -> confirmed; a later status query reports it filled
  | "filled"
  | "partially_filled"
  | "rejected"
  | "canceled"
  | "timeout" // the tool call never resolves; the caller's own request timeout must fire
  | "ambiguous"; // SYNTHETIC: a response with a `state` this codebase does not recognize

export interface MockRobinhoodOptions {
  /** client_order_id (as sent on the wire, i.e. String(...)) -> canned scenario. An id with no
   *  entry defaults to "accepted" on place, then reports "filled" on a status query -- the
   *  ordinary happy path. */
  scenarios?: Record<string, MockScenario>;
}

const PLACE_TOOLS = new Set(["place_equity_order", "place_crypto_order"]);
const PREVIEW_TOOLS = new Set(["review_equity_order", "preview_crypto_order"]);
const CANCEL_TOOLS = new Set(["cancel_equity_order", "cancel_crypto_order"]);
const STATUS_TOOLS = new Set(["get_equity_orders", "get_crypto_orders"]);
const QUOTE_TOOLS = new Set(["get_equity_quotes", "get_crypto_quotes"]);

function structured(body: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function placeBody(scenario: MockScenario, clientOrderId: string, qty: string, price: string): Record<string, unknown> {
  const venueOrderId = `SYN-${clientOrderId}`;
  switch (scenario) {
    case "rejected":
      return { state: "rejected", id: venueOrderId, client_order_id: clientOrderId, reject_reason: "SYNTHETIC: insufficient buying power" };
    case "partially_filled":
      return { state: "partially_filled", id: venueOrderId, client_order_id: clientOrderId, filled_quantity: (Number(qty) / 2).toString(), average_price: price };
    case "filled":
      return { state: "filled", id: venueOrderId, client_order_id: clientOrderId, filled_quantity: qty, average_price: price };
    case "canceled":
      return { state: "canceled", id: venueOrderId, client_order_id: clientOrderId };
    case "ambiguous":
      return { state: "SYNTHETIC_UNKNOWN_STATE", id: venueOrderId, client_order_id: clientOrderId };
    case "accepted":
    default:
      return { state: "confirmed", id: venueOrderId, client_order_id: clientOrderId };
  }
}

/** Builds an MCP Server exposing every tool agent/src/broker/robinhood.ts calls, backed by
 *  per-client_order_id canned scenarios. Connect it with a Transport (e.g. one half of
 *  `InMemoryTransport.createLinkedPair()`) the way a real client/server pair would connect. */
export function createMockRobinhoodServer(opts: MockRobinhoodOptions = {}): Server {
  const scenarios = opts.scenarios ?? {};
  // Tracks what "placed" so a later status query can answer consistently (e.g. "accepted" at
  // place time, "filled" once queried -- the common eventually-consistent broker pattern).
  const placed = new Map<string, { scenario: MockScenario; qty: string; price: string }>();

  const server = new Server(
    { name: "mock-robinhood-agentic-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...PLACE_TOOLS, ...PREVIEW_TOOLS, ...CANCEL_TOOLS, ...STATUS_TOOLS, ...QUOTE_TOOLS].map((name) => ({
      name,
      description: `SYNTHETIC mock of Robinhood's ${name}`,
      inputSchema: { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    const clientOrderId = typeof args.client_order_id === "string" ? args.client_order_id : "";
    const scenario = scenarios[clientOrderId] ?? "accepted";

    if (PREVIEW_TOOLS.has(name)) {
      return structured({ warnings: ["SYNTHETIC: preview only, not a real pre-trade check"] });
    }

    if (PLACE_TOOLS.has(name)) {
      const qty = typeof args.quantity === "string" ? args.quantity : "0";
      const price = typeof args.price === "string" ? args.price : "0";
      // A "timeout" order is recorded as if the broker really did accept it -- only our
      // response back to the caller is lost. That's what makes reconciliation via a later
      // status query meaningful instead of trivially always finding "not_found".
      placed.set(clientOrderId, { scenario: scenario === "timeout" ? "accepted" : scenario, qty, price });
      if (scenario === "timeout") {
        // Never resolves: the caller's own request timeout (mcp-client.ts's callTool timeout,
        // or the SDK's DEFAULT_REQUEST_TIMEOUT_MSEC) is what's actually under test here.
        return new Promise<CallToolResult>(() => undefined);
      }
      return structured(placeBody(scenario, clientOrderId, qty, price));
    }

    if (CANCEL_TOOLS.has(name)) {
      // Cancel requests aren't part of the per-client_order_id scenario table (that table
      // governs placement/status outcomes) -- a cancel always succeeds here. Add a distinct
      // scenario key if a test ever needs cancel_rejected specifically.
      return structured({ state: "canceled" });
    }

    if (STATUS_TOOLS.has(name)) {
      const entry = placed.get(clientOrderId);
      if (!entry) return structured({ orders: [] });
      // A status query reports "accepted" placements as filled -- the eventual-consistency case
      // gateway.ts's reconciliation path (timeout -> status query) depends on.
      const resolved: MockScenario = entry.scenario === "accepted" ? "filled" : entry.scenario;
      return structured({ orders: [placeBody(resolved, clientOrderId, entry.qty, entry.price)] });
    }

    if (QUOTE_TOOLS.has(name)) {
      return structured({ quotes: [{ symbol: args.symbols, bid: "100.00", ask: "100.05" }] });
    }

    return errorResult(`SYNTHETIC mock has no handler for tool ${name}`);
  });

  return server;
}
