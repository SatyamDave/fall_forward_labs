// Mock Robinhood Agentic Trading MCP server (issues #35, #43): synthetic, clearly labelled
// responses over a real MCP server/client handshake, so agent/src/broker/robinhood.ts and
// mcp-client.ts are exercised through the real @modelcontextprotocol/sdk wire protocol. No
// network call and no real Robinhood connection -- hard limit.
//
// Input schemas are the REAL ones from the founder's tools/list run (issue #26,
// docs/research/robinhood-tools-2026-09-29.json), and every call is checked against them: a
// missing required argument, an argument the real schema does not have, or a wrong JSON type is
// an error here, as it would be upstream. Every response uses the real envelope,
// `{ data, guide }`, and get_accounts, the quote tools and get_equity_price_book return the real
// shapes the read-only probe recorded (docs/research/robinhood-shapes-2026-09-29.json). Order,
// position and book-level fields are still this testkit's guesses (UNVERIFIED, see robinhood.ts's
// header). Every value is synthetic.
//
// This is deliberately NOT agent/src/testkit/fake-bridge.ts (that fakes qc-bridge). This fakes
// Robinhood, over MCP.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { fromFixed, toFixed } from "../decimal.js";
import { repoRoot } from "../paths.js";

export type MockScenario =
  | "accepted" // rests as `confirmed`; a cancel moves it to `cancelled`
  | "filled"
  | "partially_filled" // half filled and still resting; a cancel keeps the half
  | "rejected"
  | "canceled"
  | "timeout" // the broker fills it, but the response never arrives
  | "lost_once" // the first send never arrives and never answers; a resend with the same ref_id fills
  | "never_arrives" // no send ever arrives or answers
  | "cancel_fails_filled" // rests; the cancel errors because the order filled first
  | "cancel_stuck" // rests; every cancel errors and it stays live
  | "ambiguous"; // SYNTHETIC: a response with a `state` this codebase does not recognize

/** The synthetic account the mock knows by default. */
export const MOCK_ACCOUNT_NUMBER = "SYNTH0001";

export interface MockRobinhoodOptions {
  /** Placement sequence number ("1" for the first distinct ref_id placed, "2" for the next, ...)
   *  -> scenario. Unlisted orders are "accepted". A resend with a ref_id already seen is the same
   *  order (the upstream deduplicates by ref_id), so it keeps its number and scenario. */
  scenarios?: Record<string, MockScenario>;
  /** Invoked on every CallTool request, before any argument check or scenario logic. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  /** The account the mock owns; any other account_number is refused. */
  accountNumber?: string;
  /** Overrides get_accounts' `accounts` list, e.g. to make the account non-agentic. */
  accounts?: Array<Record<string, unknown>>;
  /** get_equity_positions' quantity for `positionSymbol` (default "SPY"). Defaults to the mock's
   *  own bookkeeping of every order's signed fills, per symbol. */
  position?: string;
  positionSymbol?: string;
  /** Adds a `cash` field to the account entry. The real entry has none, so neither does the
   *  default. */
  cash?: string | null;
  /** get_equity_price_book returns empty asks and bids, as the real one does after hours. */
  emptyBook?: boolean;
  /** Rewrites the tool list ListTools returns, for the schema check's tests. */
  listTools?: (tools: MockTool[]) => MockTool[];
}

export type MockTool = Tool;

const MOCKED_TOOLS = [
  "place_equity_order",
  "review_equity_order",
  "cancel_equity_order",
  "get_equity_orders",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_price_book",
  "get_accounts",
  "get_crypto_quotes",
] as const;

let realSchemas: Map<string, Tool["inputSchema"]> | undefined;

function realInputSchemas(): Map<string, Tool["inputSchema"]> {
  if (!realSchemas) {
    const dump = JSON.parse(readFileSync(path.join(repoRoot(), "docs", "research", "robinhood-tools-2026-09-29.json"), "utf8")) as {
      tools: Array<{ name: string; inputSchema: Tool["inputSchema"] }>;
    };
    realSchemas = new Map(dump.tools.map((t) => [t.name, t.inputSchema]));
  }
  return realSchemas;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
}

/** Why `args` would not pass the real input schema; empty when it would. */
function schemaProblems(schema: Tool["inputSchema"], args: Record<string, unknown>): string[] {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string | string[] }>;
  const problems: string[] = [];
  for (const required of schema.required ?? []) if (!(required in args)) problems.push(`missing required "${required}"`);
  for (const [name, value] of Object.entries(args)) {
    const prop = properties[name];
    if (!prop) {
      if (schema.additionalProperties === false) problems.push(`unknown argument "${name}"`);
      continue;
    }
    const allowed = prop.type === undefined ? undefined : Array.isArray(prop.type) ? prop.type : [prop.type];
    if (allowed && !allowed.includes(jsonType(value))) problems.push(`"${name}" is ${jsonType(value)}, schema says ${allowed.join("|")}`);
  }
  return problems;
}

function structured(data: Record<string, unknown>): CallToolResult {
  const body = { data, guide: "SYNTHETIC guide text" };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

/** One get_accounts entry in the real shape. */
function accountEntry(accountNumber: string, cash: string | null | undefined): Record<string, unknown> {
  return {
    account_number: accountNumber,
    rhs_account_number: "SYNTHRHS1",
    rhc_account_number: "SYNTHRHC1",
    type: "cash",
    unsettled_funds: "0.0000",
    brokerage_account_type: "individual",
    is_default: true,
    agentic_allowed: true,
    option_level: "",
    management_type: "self_directed",
    affiliate: "rhf",
    state: "active",
    deactivated: false,
    permanently_deactivated: false,
    ...(typeof cash === "string" ? { cash } : {}),
  };
}

/** One get_equity_quotes result in the real shape; the same 100.00/100.05 top of book as the book. */
function quoteResult(symbol: string): Record<string, unknown> {
  const t = "2026-09-29T14:30:00Z";
  return {
    quote: {
      symbol,
      last_trade_price: "100.020000",
      venue_last_trade_time: t,
      last_non_reg_trade_price: "100.020000",
      venue_last_non_reg_trade_time: t,
      adjusted_previous_close: "99.500000",
      previous_close: "99.500000",
      previous_close_date: "2026-09-28",
      bid_price: "100.000000",
      venue_bid_time: t,
      ask_price: "100.050000",
      venue_ask_time: t,
      has_traded: true,
      state: "active",
    },
    close: { symbol, date: "2026-09-28", price: "99.500000", interpolated: false, source: "SYNTHETIC" },
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

interface MockOrder {
  id: string;
  ref_id: string;
  scenario: MockScenario;
  symbol: string;
  side: string;
  quantity: string;
  limit_price: string;
  state: string;
  filled: bigint; // fixed-point, decimal.ts scale
  reject_reason?: string;
}

const LIVE_STATES = new Set(["confirmed", "partially_filled"]);

function orderBody(o: MockOrder): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: o.id,
    ref_id: o.ref_id,
    state: o.state,
    symbol: o.symbol,
    side: o.side,
    quantity: o.quantity,
    limit_price: o.limit_price,
    filled_quantity: fromFixed(o.filled),
  };
  if (o.filled > 0n) body.average_price = o.limit_price;
  if (o.reject_reason) body.reject_reason = o.reject_reason;
  return body;
}

/** Builds an MCP Server exposing every tool agent/src/broker/robinhood.ts calls. Connect it with
 *  a Transport (e.g. one half of `InMemoryTransport.createLinkedPair()`). */
export function createMockRobinhoodServer(opts: MockRobinhoodOptions = {}): Server {
  const scenarios = opts.scenarios ?? {};
  const account = opts.accountNumber ?? MOCK_ACCOUNT_NUMBER;
  const schemas = realInputSchemas();
  // Outlives any one transport, so a reconnect is "same broker, new connection".
  const byRefId = new Map<string, MockOrder>();
  const seqByRefId = new Map<string, number>();
  const lostOnceSpent = new Set<string>();

  function newOrder(refId: string, scenario: MockScenario, args: Record<string, unknown>): MockOrder {
    const seq = seqByRefId.get(refId)!;
    const quantity = String(args.quantity ?? "0");
    const full = toFixed(quantity);
    const [state, filled, reject_reason] = ((): [string, bigint, string?] => {
      switch (scenario) {
        case "filled":
        case "timeout":
        case "lost_once":
          return ["filled", full];
        case "partially_filled":
          return ["partially_filled", full / 2n];
        case "rejected":
          return ["rejected", 0n, "SYNTHETIC: insufficient buying power"];
        case "canceled":
          return ["cancelled", 0n];
        case "ambiguous":
          return ["SYNTHETIC_UNKNOWN_STATE", 0n];
        default:
          return ["confirmed", 0n];
      }
    })();
    return {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      ref_id: refId,
      scenario,
      symbol: String(args.symbol),
      side: String(args.side),
      quantity,
      limit_price: String(args.limit_price ?? "0"),
      state,
      filled,
      reject_reason,
    };
  }

  function positions(): Array<{ symbol: string; quantity: string }> {
    if (opts.position !== undefined) return [{ symbol: opts.positionSymbol ?? "SPY", quantity: opts.position }];
    const bySymbol = new Map<string, bigint>();
    for (const o of byRefId.values()) {
      bySymbol.set(o.symbol, (bySymbol.get(o.symbol) ?? 0n) + (o.side === "sell" ? -o.filled : o.filled));
    }
    return [...bySymbol].map(([symbol, qty]) => ({ symbol, quantity: fromFixed(qty) }));
  }

  const server = new Server({ name: "mock-robinhood-agentic-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });

  const tools: MockTool[] = MOCKED_TOOLS.map((name) => {
    const inputSchema = schemas.get(name);
    if (!inputSchema) throw new Error(`the committed tools dump has no ${name}`);
    return { name, description: `SYNTHETIC mock of Robinhood's ${name} (real input schema, 2026-09-29)`, inputSchema: structuredClone(inputSchema) };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: opts.listTools ? opts.listTools(tools) : tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    opts.onToolCall?.(name, args);
    const schema = schemas.get(name);
    if (!schema || !(MOCKED_TOOLS as readonly string[]).includes(name)) return errorResult(`SYNTHETIC mock has no handler for tool ${name}`);
    const problems = schemaProblems(schema, args);
    if (problems.length > 0) return errorResult(`SYNTHETIC mock: ${name} arguments do not match the real input schema: ${problems.join("; ")}`);
    if ("account_number" in args && args.account_number !== account) return errorResult("SYNTHETIC: account_number is not an account of this user");

    switch (name) {
      case "review_equity_order":
        return structured({ warnings: ["SYNTHETIC: preview only, not a real pre-trade check"] });

      case "place_equity_order": {
        const refId = typeof args.ref_id === "string" ? args.ref_id : "";
        if (!refId) return errorResult("SYNTHETIC mock requires ref_id");
        if (!seqByRefId.has(refId)) seqByRefId.set(refId, seqByRefId.size + 1);
        const scenario = scenarios[String(seqByRefId.get(refId))] ?? "accepted";
        if (scenario === "never_arrives") return new Promise<CallToolResult>(() => undefined);
        if (scenario === "lost_once" && !lostOnceSpent.has(refId)) {
          lostOnceSpent.add(refId);
          return new Promise<CallToolResult>(() => undefined); // never arrived, never answers
        }
        const existing = byRefId.get(refId);
        if (existing) return structured(orderBody(existing)); // upstream dedup by ref_id
        const order = newOrder(refId, scenario, args);
        byRefId.set(refId, order);
        // Recorded as if the broker really did get it; only the response back is lost.
        if (scenario === "timeout") return new Promise<CallToolResult>(() => undefined);
        return structured(orderBody(order));
      }

      case "cancel_equity_order": {
        const order = [...byRefId.values()].find((o) => o.id === args.order_id);
        if (!order) return errorResult("SYNTHETIC: order not found in this account");
        if (order.scenario === "cancel_fails_filled") {
          order.state = "filled";
          order.filled = toFixed(order.quantity);
          return errorResult("SYNTHETIC: order already filled, cannot cancel");
        }
        if (order.scenario === "cancel_stuck") return errorResult("SYNTHETIC: cancel failed, try again");
        if (!LIVE_STATES.has(order.state)) return errorResult(`SYNTHETIC: order is ${order.state}, cannot cancel`);
        order.state = "cancelled";
        return structured(orderBody(order));
      }

      case "get_equity_orders": {
        let orders = [...byRefId.values()];
        if (typeof args.order_id === "string") orders = orders.filter((o) => o.id === args.order_id);
        if (typeof args.symbol === "string") orders = orders.filter((o) => o.symbol === args.symbol);
        return structured({ orders: orders.map(orderBody), next: null });
      }

      case "get_equity_positions":
        return structured({ positions: positions(), next: null });

      case "get_accounts": {
        return structured({ accounts: opts.accounts ?? [accountEntry(account, opts.cash)] });
      }

      case "get_equity_quotes":
      case "get_crypto_quotes": {
        // get_crypto_quotes' real parameter is also `symbols` (array); every value is SYNTHETIC.
        const symbols = Array.isArray(args.symbols) ? args.symbols.filter((x): x is string => typeof x === "string") : [];
        return structured({ results: symbols.map(quoteResult) });
      }

      case "get_equity_price_book": {
        const symbols = Array.isArray(args.symbols) ? args.symbols.filter((s): s is string => typeof s === "string") : [];
        // SYNTHETIC 3-level book per side, strictly sorted best-first and centered on the same
        // 100.00/100.05 top of book the quote tools report. Level fields (price, quantity) are
        // UNVERIFIED: the real probe only saw empty books.
        const levels = opts.emptyBook
          ? { asks: [], bids: [] }
          : {
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
            };
        return structured({ books: symbols.map((symbol) => ({ symbol, updated_at: "2026-09-29T14:30:00Z", ...levels })) });
      }
    }
    return errorResult(`SYNTHETIC mock has no handler for tool ${name}`);
  });

  return server;
}
