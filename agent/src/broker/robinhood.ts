// The ONLY module that knows Robinhood's Agentic Trading MCP tool names and parameter shapes.
// Every other file in agent/src/broker/ talks to Robinhood exclusively through the functions
// below. If issue #26 (or a real MCP connection) turns up different tool names or parameter
// shapes, this is the one file that changes.
//
// UNVERIFIED (robinhood-agentic-mcp.md §2, "Blockers/unknowns" #1): Robinhood publishes tool
// *names* (this session's research pass, primary-sourced) but no parameter-level JSON schema --
// that's only visible by connecting a live client, which is out of scope until #26. Every
// parameter name below, and the assumption that place_*_order accepts a client-supplied
// `client_order_id` for idempotent status lookups, is this module's own placeholder, not a
// confirmed schema. #43 replaces these once #26 lands.
import type { CallToolResult, McpClient } from "./mcp-client.js";
import type {
  ApprovedOrder,
  AssetClass,
  CancelOrderResult,
  DecimalString,
  OrderStatusResult,
  PlaceOrderResult,
  PreviewResult,
} from "./types.js";

export class RobinhoodToolError extends Error {
  constructor(
    public readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = "RobinhoodToolError";
  }
}

// Single source of truth for the name mapping (robinhood-agentic-mcp.md §2's tool tables).
const TOOLS: Record<
  AssetClass,
  { place: string; cancel: string; preview: string; status: string; quote: string; positions: string }
> = {
  equity: {
    place: "place_equity_order",
    cancel: "cancel_equity_order",
    preview: "review_equity_order",
    status: "get_equity_orders",
    quote: "get_equity_quotes",
    positions: "get_equity_positions",
  },
  crypto: {
    place: "place_crypto_order",
    cancel: "cancel_crypto_order",
    preview: "preview_crypto_order",
    status: "get_crypto_orders",
    quote: "get_crypto_quotes",
    // UNVERIFIED name -- robinhood-agentic-mcp.md §2 names get_equity_positions for equity but
    // does not confirm a crypto equivalent; this is this module's own placeholder (module
    // header), replaced once #26 lands.
    positions: "get_crypto_holdings",
  },
};

// UNVERIFIED name (module header): not asset-class-specific -- one account, called once
// regardless of which asset class the reconciliation run is otherwise pulling orders/positions
// for. Issue #45's engineering notes cite `get_accounts`/`get_portfolio` for cash.
const ACCOUNT_TOOL = "get_accounts";

// UNVERIFIED shape -- see module header.
function placeParams(order: ApprovedOrder): Record<string, unknown> {
  return {
    symbol: order.instrument,
    side: order.side,
    quantity: order.qty,
    price: order.limit_price,
    time_in_force: order.time_in_force,
    client_order_id: String(order.client_order_id),
  };
}

export interface CallOptions {
  /** Per-call request timeout in ms. A placeOrder/getOrderStatus call that exceeds this throws
   *  -- the gateway treats that the same as any other transport failure: outcome unknown,
   *  reconcile via status before ever trying again (never a blind retry). */
  timeoutMs?: number;
}

async function callTool(client: McpClient, tool: string, args: Record<string, unknown>, opts?: CallOptions): Promise<CallToolResult> {
  return client.callTool({ name: tool, arguments: args }, undefined, { timeout: opts?.timeoutMs }) as Promise<CallToolResult>;
}

/** Pulls the tool's structured payload out of a CallToolResult. Never guesses a default when
 *  the shape doesn't parse -- an ambiguous response is a thrown error, same bucket as a
 *  transport failure, so the gateway treats both as "outcome unknown, reconcile before retry". */
function unwrap(tool: string, result: CallToolResult): Record<string, unknown> {
  if (result.isError) {
    const text = result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
    throw new RobinhoodToolError(tool, text ?? "tool reported an error with no text content");
  }
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  const text = result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
  if (!text) throw new RobinhoodToolError(tool, "response has neither structuredContent nor text content");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RobinhoodToolError(tool, `text content is not JSON: ${text.slice(0, 200)}`);
  }
}

function asDecimalString(value: unknown): DecimalString | undefined {
  return typeof value === "string" ? value : undefined;
}

const PLACE_STATES: Record<string, PlaceOrderResult["status"]> = {
  confirmed: "accepted",
  filled: "filled",
  partially_filled: "partially_filled",
  rejected: "rejected",
  canceled: "canceled",
};

/** The mapping table for a place/cancel response's `state` field, normalized into our own
 *  vocabulary. Anything not in PLACE_STATES is a broker response we don't understand -- throw,
 *  don't guess (an unrecognized state is exactly the "ambiguous response" case). */
function normalizePlaceResult(tool: string, body: Record<string, unknown>): PlaceOrderResult {
  const state = body.state;
  const status = typeof state === "string" ? PLACE_STATES[state] : undefined;
  if (!status) {
    throw new RobinhoodToolError(tool, `unrecognized order state: ${JSON.stringify(state)}`);
  }
  return {
    status,
    venue_order_id: typeof body.id === "string" ? body.id : undefined,
    filled_qty: asDecimalString(body.filled_quantity),
    avg_price: asDecimalString(body.average_price),
    reason: typeof body.reject_reason === "string" ? body.reject_reason : undefined,
    raw: body,
  };
}

export async function previewOrder(
  client: McpClient,
  assetClass: AssetClass,
  order: ApprovedOrder,
  opts?: CallOptions,
): Promise<PreviewResult> {
  const tool = TOOLS[assetClass].preview;
  const raw = unwrap(tool, await callTool(client, tool, placeParams(order), opts));
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === "string") : [];
  return { warnings, raw };
}

export async function placeOrder(
  client: McpClient,
  assetClass: AssetClass,
  order: ApprovedOrder,
  opts?: CallOptions,
): Promise<PlaceOrderResult> {
  const tool = TOOLS[assetClass].place;
  const raw = unwrap(tool, await callTool(client, tool, placeParams(order), opts));
  return normalizePlaceResult(tool, raw);
}

export async function cancelOrder(
  client: McpClient,
  assetClass: AssetClass,
  clientOrderId: number,
  instrument: string,
  opts?: CallOptions,
): Promise<CancelOrderResult> {
  const tool = TOOLS[assetClass].cancel;
  // UNVERIFIED shape -- see module header.
  const raw = unwrap(tool, await callTool(client, tool, { symbol: instrument, client_order_id: String(clientOrderId) }, opts));
  const state = raw.state;
  const status = state === "canceled" ? "canceled" : state === "cancel_rejected" ? "cancel_rejected" : undefined;
  if (!status) throw new RobinhoodToolError(tool, `unrecognized cancel state: ${JSON.stringify(state)}`);
  return { status, reason: typeof raw.reject_reason === "string" ? raw.reject_reason : undefined, raw };
}

/**
 * Order-status lookup, keyed by our own client_order_id. Robinhood's published tool
 * (`get_equity_orders`/`get_crypto_orders`) is documented only as "status history" -- no
 * single-order-by-id fetch is confirmed, so this assumes the list tool accepts a
 * `client_order_id` filter (UNVERIFIED) and returns `{ orders: [...] }`. If the real tool has
 * no such filter, this has to fall back to fetching the full list and filtering client-side.
 */
export async function getOrderStatus(
  client: McpClient,
  assetClass: AssetClass,
  clientOrderId: number,
  opts?: CallOptions,
): Promise<OrderStatusResult> {
  const tool = TOOLS[assetClass].status;
  const raw = unwrap(tool, await callTool(client, tool, { client_order_id: String(clientOrderId) }, opts));
  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  const match = orders.find(
    (o): o is Record<string, unknown> => typeof o === "object" && o !== null && (o as Record<string, unknown>).client_order_id === String(clientOrderId),
  );
  if (!match) return { status: "not_found", raw: null };
  const state = match.state;
  const status = typeof state === "string" ? PLACE_STATES[state] : undefined;
  if (!status) throw new RobinhoodToolError(tool, `unrecognized order state: ${JSON.stringify(state)}`);
  return {
    status,
    venue_order_id: typeof match.id === "string" ? match.id : undefined,
    filled_qty: asDecimalString(match.filled_quantity),
    avg_price: asDecimalString(match.average_price),
    reason: typeof match.reject_reason === "string" ? match.reject_reason : undefined,
    raw: match,
  };
}

export async function getQuote(
  client: McpClient,
  assetClass: AssetClass,
  instrument: string,
  opts?: CallOptions,
): Promise<Record<string, unknown>> {
  const tool = TOOLS[assetClass].quote;
  return unwrap(tool, await callTool(client, tool, { symbols: [instrument] }, opts));
}

/** One order exactly as the broker itself reports it -- issue #45's reconciliation input. Not
 *  filtered by client_order_id (unlike `getOrderStatus` above): this is "give me everything you
 *  have", the shape `reconcile.ts` needs to compare against the bridge's own OMS state. */
export interface VenueOrder {
  client_order_id: number | null;
  venue_order_id: string | null;
  status: PlaceOrderResult["status"] | "not_found";
  filled_qty?: DecimalString;
}

export async function listOrders(client: McpClient, assetClass: AssetClass, opts?: CallOptions): Promise<VenueOrder[]> {
  const tool = TOOLS[assetClass].status;
  const raw = unwrap(tool, await callTool(client, tool, {}, opts));
  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  return orders
    .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
    .map((o) => {
      const state = o.state;
      const status = typeof state === "string" ? PLACE_STATES[state] : undefined;
      if (!status) {
        // An unrecognized state here is exactly the "ambiguous broker response" case (module
        // header, and the same convention `normalizePlaceResult` uses) -- throw, don't guess.
        throw new RobinhoodToolError(tool, `unrecognized order state in listOrders: ${JSON.stringify(state)}`);
      }
      const rawClientOrderId = o.client_order_id;
      return {
        client_order_id: typeof rawClientOrderId === "string" && rawClientOrderId !== "" ? Number(rawClientOrderId) : null,
        venue_order_id: typeof o.id === "string" ? o.id : null,
        status,
        filled_qty: asDecimalString(o.filled_quantity),
      };
    });
}

/** Position and cash for one instrument's account, for issue #45's daily/startup/periodic
 *  reconciliation against the bridge's own OMS-tracked position. `cash` is account-level (not
 *  per-instrument), `position` is this instrument's own held quantity. UNVERIFIED shapes --
 *  module header. */
export interface AccountState {
  position: DecimalString;
  cash: DecimalString | null;
}

export async function getAccountState(
  client: McpClient,
  assetClass: AssetClass,
  instrument: string,
  opts?: CallOptions,
): Promise<AccountState> {
  const positionsTool = TOOLS[assetClass].positions;
  const positionsRaw = unwrap(positionsTool, await callTool(client, positionsTool, { symbol: instrument }, opts));
  const positions = Array.isArray(positionsRaw.positions) ? positionsRaw.positions : [];
  const match = positions.find(
    (p): p is Record<string, unknown> => typeof p === "object" && p !== null && (p as Record<string, unknown>).symbol === instrument,
  );
  const position = (match && asDecimalString(match.quantity)) ?? "0";

  const accountRaw = unwrap(ACCOUNT_TOOL, await callTool(client, ACCOUNT_TOOL, {}, opts));
  const cash = asDecimalString(accountRaw.cash) ?? null;

  return { position, cash };
}
