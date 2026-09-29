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
  /** Test hook: invoked with the tool name on every CallTool request, before any scenario logic
   *  runs. This is how a test proves "the place tool was never called a second time" from the
   *  outside, e.g. across a simulated process restart. */
  onToolCall?: (name: string) => void;
  /** Issue #45 (reconciliation): what get_equity_positions/get_crypto_holdings reports for the
   *  one instrument a reconcile call asks about. Defaults to the sum of every placed order's own
   *  actually-filled quantity (signed by side) -- i.e. this mock's own honest bookkeeping, so a
   *  multi-order simulation stays self-consistent without the caller hand-computing it. Pass an
   *  explicit value, including one that deliberately disagrees with that bookkeeping, to prove a
   *  reconciliation mismatch gets flagged rather than silently trusted. */
  position?: string;
  /** What get_accounts reports as cash. `null` reports no cash field at all (some responses may
   *  omit it). Defaults to a fixed synthetic balance. */
  cash?: string | null;
  /** Test hook for the schema check (#26): rewrites the tool list ListTools returns, e.g. to
   *  rename a tool or a parameter and prove the check catches it. */
  listTools?: (tools: MockTool[]) => MockTool[];
}

export interface MockTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, object>; required?: string[] };
}

// SYNTHETIC input schemas, written to match robinhood.ts's own UNVERIFIED placeholder arguments
// so `just robinhood-schema-check` passes against this mock. They say nothing about Robinhood's
// real schemas; that comparison is the whole point of running the check against the real server.
const str = { type: "string" };
const ORDER_SCHEMA = {
  type: "object" as const,
  properties: { symbol: str, side: str, quantity: str, price: str, time_in_force: str, client_order_id: str },
  required: ["symbol", "side", "quantity"],
};
const INPUT_SCHEMAS: Record<string, MockTool["inputSchema"]> = {
  place: ORDER_SCHEMA,
  preview: ORDER_SCHEMA,
  cancel: { type: "object", properties: { symbol: str, client_order_id: str } },
  status: { type: "object", properties: { client_order_id: str } },
  symbols: { type: "object", properties: { symbols: { type: "array", items: str } }, required: ["symbols"] },
  position: { type: "object", properties: { symbol: str } },
  none: { type: "object", properties: {} },
};

const PLACE_TOOLS = new Set(["place_equity_order", "place_crypto_order"]);
const PREVIEW_TOOLS = new Set(["review_equity_order", "preview_crypto_order"]);
const CANCEL_TOOLS = new Set(["cancel_equity_order", "cancel_crypto_order"]);
const STATUS_TOOLS = new Set(["get_equity_orders", "get_crypto_orders"]);
const QUOTE_TOOLS = new Set(["get_equity_quotes", "get_crypto_quotes"]);
// Level 2 (issue #43/#46 follow-up): equity only -- robinhood-agentic-mcp.md §2 lists no
// equivalent tool for options or crypto, and robinhood.ts's TOOLS table has no crypto `book`
// entry to match, so a crypto pollBook() falls back to QUOTE_TOOLS instead of reaching here.
const BOOK_TOOLS = new Set(["get_equity_price_book"]);
// Issue #45 (reconciliation): read-only tools with no client_order_id filter.
const POSITIONS_TOOLS = new Set(["get_equity_positions", "get_crypto_holdings"]);
const ACCOUNT_TOOLS = new Set(["get_accounts"]);

function structured(body: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function placeBody(scenario: MockScenario, clientOrderId: string, qty: string, price: string): Record<string, unknown> {
  // Wave-2 integration finding: this used to be `SYN-${clientOrderId}`, which
  // engine/crates/bridge/src/wire.rs's `parse_venue_order_id` rejects -- `qc_core::VenueOrderId`
  // is a `u64` newtype, and the real bridge requires the wire's `venue_order_id` to be a
  // decimal-integer string (documented as UNVERIFIED against a real broker until #26, in exactly
  // this one place). A synthetic id only ever needs to be distinct and traceable back to the
  // client_order_id that produced it, not to look like a human-readable label, so this is
  // decimal instead: real Robinhood order ids may not be, once #26 verifies the actual format.
  const venueOrderId = String(900_000 + Number(clientOrderId));
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
  const placed = new Map<string, { scenario: MockScenario; qty: string; price: string; side: string }>();

  /** How much of `entry` has actually filled, signed by side -- used only to derive a default
   *  `position` (issue #45 reconciliation) when the caller doesn't pass one explicitly. Uses the
   *  order's OWN scenario, not STATUS_TOOLS's query-time "accepted -> filled" reinterpretation
   *  above: a not-yet-filled ("accepted") order hasn't moved position yet, however a later status
   *  query might narrate it for other purposes. */
  function signedFilledQty(entry: { scenario: MockScenario; qty: string; side: string }): number {
    const filled = entry.scenario === "filled" ? Number(entry.qty) : entry.scenario === "partially_filled" ? Number(entry.qty) / 2 : 0;
    return entry.side === "sell" ? -filled : filled;
  }

  const server = new Server(
    { name: "mock-robinhood-agentic-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const toolGroups: [Set<string>, keyof typeof INPUT_SCHEMAS][] = [
    [PLACE_TOOLS, "place"],
    [PREVIEW_TOOLS, "preview"],
    [CANCEL_TOOLS, "cancel"],
    [STATUS_TOOLS, "status"],
    [QUOTE_TOOLS, "symbols"],
    [BOOK_TOOLS, "symbols"],
    [POSITIONS_TOOLS, "position"],
    [ACCOUNT_TOOLS, "none"],
  ];
  const tools: MockTool[] = toolGroups.flatMap(([names, schema]) =>
    [...names].map((name) => ({ name, description: `SYNTHETIC mock of Robinhood's ${name}`, inputSchema: structuredClone(INPUT_SCHEMAS[schema]!) })),
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: opts.listTools ? opts.listTools(tools) : tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    opts.onToolCall?.(name);
    const clientOrderId = typeof args.client_order_id === "string" ? args.client_order_id : "";
    const scenario = scenarios[clientOrderId] ?? "accepted";

    if (PREVIEW_TOOLS.has(name)) {
      return structured({ warnings: ["SYNTHETIC: preview only, not a real pre-trade check"] });
    }

    if (PLACE_TOOLS.has(name)) {
      const qty = typeof args.quantity === "string" ? args.quantity : "0";
      const price = typeof args.price === "string" ? args.price : "0";
      const side = typeof args.side === "string" ? args.side : "buy";
      // A "timeout" order is recorded as if the broker really did accept it -- only our
      // response back to the caller is lost. That's what makes reconciliation via a later
      // status query meaningful instead of trivially always finding "not_found".
      placed.set(clientOrderId, { scenario: scenario === "timeout" ? "accepted" : scenario, qty, price, side });
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
      if (clientOrderId) {
        const entry = placed.get(clientOrderId);
        if (!entry) return structured({ orders: [] });
        // A status query reports "accepted" placements as filled -- the eventual-consistency
        // case gateway.ts's reconciliation path (timeout -> status query) depends on.
        const resolved: MockScenario = entry.scenario === "accepted" ? "filled" : entry.scenario;
        return structured({ orders: [placeBody(resolved, clientOrderId, entry.qty, entry.price)] });
      }
      // No client_order_id filter: issue #45's listOrders() wants everything the broker has.
      const orders = [...placed.entries()].map(([id, entry]) => {
        const resolved: MockScenario = entry.scenario === "accepted" ? "filled" : entry.scenario;
        return placeBody(resolved, id, entry.qty, entry.price);
      });
      return structured({ orders });
    }

    if (POSITIONS_TOOLS.has(name)) {
      const symbol = typeof args.symbol === "string" ? args.symbol : undefined;
      const quantity =
        opts.position ??
        [...placed.values()].reduce((sum, entry) => sum + signedFilledQty(entry), 0).toString();
      return structured({ positions: symbol ? [{ symbol, quantity }] : [] });
    }

    if (ACCOUNT_TOOLS.has(name)) {
      const cash = opts.cash === undefined ? "10000.00" : opts.cash;
      return structured(cash === null ? {} : { cash });
    }

    if (QUOTE_TOOLS.has(name)) {
      return structured({ quotes: [{ symbol: args.symbols, bid: "100.00", ask: "100.05" }] });
    }

    if (BOOK_TOOLS.has(name)) {
      const symbols = Array.isArray(args.symbols) ? args.symbols.filter((s): s is string => typeof s === "string") : [];
      // SYNTHETIC 3-level book per side, strictly sorted best-first and centered on the same
      // 100.00/100.05 top-of-book QUOTE_TOOLS reports -- deterministic and clearly labelled, per
      // the hard limit on recorded/synthetic Robinhood responses only.
      const books = symbols.map((symbol) => ({
        symbol,
        bids: [
          { price: "99.99", quantity: "500" },
          { price: "99.98", quantity: "300" },
          { price: "99.97", quantity: "200" },
        ],
        asks: [
          { price: "100.05", quantity: "400" },
          { price: "100.06", quantity: "250" },
          { price: "100.07", quantity: "150" },
        ],
      }));
      return structured({ books });
    }

    return errorResult(`SYNTHETIC mock has no handler for tool ${name}`);
  });

  return server;
}
