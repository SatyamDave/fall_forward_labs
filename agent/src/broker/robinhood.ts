// The ONLY module that knows Robinhood's Agentic Trading MCP tool names and parameter shapes.
// Every other file in agent/src/broker/ talks to Robinhood exclusively through the functions
// below.
//
// Input schemas: VERIFIED against the real server's tools/list (issue #26, the founder's run on
// 2026-09-29, committed as docs/research/robinhood-tools-2026-09-29.json). The mock server
// (src/testkit/mock-robinhood-mcp.ts) serves those exact schemas and rejects any call that does
// not satisfy them, so the tests and `just robinhood-schema-check` fail if this file drifts.
//
// Response shapes: UNVERIFIED. tools/list returned no outputSchema, and no real tool has been
// called yet. Every field read out of a response (`accounts[]`, `agentic_allowed`, `cash`,
// `orders[]`, `positions[]`, `next`, `books[]`, and an order's `id`/`ref_id`/`state`/
// `filled_quantity`/`average_price`/`reject_reason`) is a guess, parsed defensively: an
// unexpected shape throws instead of defaulting. `just robinhood-probe-readonly --target real`
// records the real shapes.
//
// Crypto: only the read-only quote tool is mapped (the recorder uses it). Crypto orders need a
// different account number (rhs_account_number), a different order-type vocabulary and gtc-only
// limit orders, and docs/decisions/0021 recommends SPY first, so crypto order tools are not
// mapped and fail closed before any call.
import { createHash } from "node:crypto";
import { fromFixed, toFixed } from "../decimal.js";
import type { CallToolResult, McpClient } from "./mcp-client.js";
import type {
  ApprovedOrder,
  AssetClass,
  BookLevel,
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

const EQUITY = {
  place: "place_equity_order",
  cancel: "cancel_equity_order",
  preview: "review_equity_order",
  orders: "get_equity_orders",
  positions: "get_equity_positions",
  book: "get_equity_price_book",
} as const;

const QUOTE_TOOLS: Record<AssetClass, string> = { equity: "get_equity_quotes", crypto: "get_crypto_quotes" };

const ACCOUNT_TOOL = "get_accounts";

/** The account every account-scoped call uses. The tool descriptions say it "must come from the
 *  user ... never default from get_accounts", so it is required configuration, never looked up. */
export const ACCOUNT_NUMBER_ENV = "QC_ROBINHOOD_ACCOUNT_NUMBER";

export function accountNumberFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = env[ACCOUNT_NUMBER_ENV];
  if (!value) throw new Error(`${ACCOUNT_NUMBER_ENV} is not set: refusing to start without the account to trade in`);
  if (!/^[A-Za-z0-9]+$/.test(value)) throw new Error(`${ACCOUNT_NUMBER_ENV} must be alphanumeric (value not shown)`);
  return value;
}

export class UnsupportedAssetClassError extends Error {
  constructor(assetClass: AssetClass) {
    super(`order execution is mapped for equity only, not ${assetClass} (docs/decisions/0021)`);
    this.name = "UnsupportedAssetClassError";
  }
}

function equityOnly(assetClass: AssetClass): typeof EQUITY {
  if (assetClass !== "equity") throw new UnsupportedAssetClassError(assetClass);
  return EQUITY;
}

// UUIDv5 namespace for ref_id. Fixed forever: changing it changes every ref_id, which would let a
// retry of an already-placed order through as a new one.
const REF_ID_NAMESPACE = Buffer.from("6f1c1d0e8a3b4c7e9d2f5a6b7c8d9e0f", "hex");

/** Robinhood's idempotency key: a UUIDv5 of the bridge's signed approval payload, so every retry
 *  of one approved order sends the same ref_id and the upstream deduplicates it. */
export function refIdForApproval(approvalPayload: string): string {
  const hash = createHash("sha1").update(REF_ID_NAMESPACE).update(approvalPayload, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** qc-bridge's VenueOrderId is a u64 (engine/crates/bridge/src/wire.rs) and Robinhood's order id
 *  is a UUID string. The bridge only needs a stable id per order, so it gets the first 8 bytes
 *  of the id's sha256 as a decimal string; the journal keeps the real id for cancels and lookups. */
export function bridgeVenueOrderId(venueOrderId: string): string {
  return createHash("sha256").update(venueOrderId, "utf8").digest().readBigUInt64BE(0).toString();
}

const ONE_SHARE = toFixed("1");
const ONE_DOLLAR = toFixed("1");
const CENT = toFixed("0.01");
const HUNDREDTH_CENT = toFixed("0.0001");

/** Why Robinhood would not take this order the way we send it, or undefined. We send whole-share
 *  limit orders only: the real schema allows fractional quantity for market orders alone, and we
 *  never send a market order. Prices must be on the penny tick at or above $1 and the 1/100-cent
 *  tick below it (SEC Rule 612; Robinhood's own tick handling is UNVERIFIED). Checked before
 *  anything is sent, so an order the venue would refuse is never an ambiguous outcome. */
export function orderRefusal(order: ApprovedOrder): string | undefined {
  let qty: bigint;
  let price: bigint;
  try {
    qty = toFixed(order.qty);
    price = toFixed(order.limit_price);
  } catch {
    return "qty or limit_price is not a decimal string";
  }
  if (qty <= 0n || qty % ONE_SHARE !== 0n) return `qty ${order.qty} is not a positive whole number of shares`;
  if (price <= 0n) return `limit_price ${order.limit_price} is not positive`;
  const tick = price >= ONE_DOLLAR ? CENT : HUNDREDTH_CENT;
  if (price % tick !== 0n) return `limit_price ${order.limit_price} is not on the ${fromFixed(tick)} tick`;
  return undefined;
}

// Robinhood has no IOC. The gateway emulates it with a gfd limit order it cancels itself
// (gateway.ts); a gtc approval stays gtc. Market orders are never sent: `type` is always "limit"
// and dollar_amount is never set. Quantities and prices go out normalized ("1", not the
// bridge's "1.00000000"), so a whole share never reads as a fractional one.
function orderParams(account: string, order: ApprovedOrder): Record<string, unknown> {
  const refusal = orderRefusal(order);
  if (refusal) throw new Error(`refusing to build a Robinhood order: ${refusal}`);
  return {
    account_number: account,
    symbol: order.instrument,
    side: order.side,
    type: "limit",
    quantity: fromFixed(toFixed(order.qty)),
    limit_price: fromFixed(toFixed(order.limit_price)),
    time_in_force: order.time_in_force === "ioc" ? "gfd" : "gtc",
    market_hours: "regular_hours",
  };
}

// review_equity_order has no ref_id parameter; only the place call carries it.
const placeParams = (account: string, order: ApprovedOrder, refId: string) => ({ ...orderParams(account, order), ref_id: refId });
const cancelParams = (account: string, venueOrderId: string) => ({ account_number: account, order_id: venueOrderId });
const recentOrdersParams = (account: string, symbol: string, createdAtGte: string) => ({
  account_number: account,
  symbol,
  created_at_gte: createdAtGte,
  placed_agent: "agentic",
});
const agenticOrdersParams = (account: string) => ({ account_number: account, placed_agent: "agentic" });
const positionsParams = (account: string) => ({ account_number: account });
const withCursor = (args: Record<string, unknown>, cursor: string | undefined) => (cursor === undefined ? args : { ...args, cursor });
const symbolsParams = (instrument: string) => ({ symbols: [instrument] });

/** The only tools `just robinhood-probe-readonly` may call (probe-readonly.ts wraps its client in
 *  recorder/allowlist.ts's readOnly() with this list). */
export const PROBE_TOOLS: ReadonlySet<string> = new Set([ACCOUNT_TOOL, EQUITY.positions, EQUITY.orders, QUOTE_TOOLS.equity, EQUITY.book]);

/** get_equity_price_book's schema: "max 4 per call". */
const BOOK_SYMBOLS_PER_CALL = 4;

/** Every call the probe makes, in order: all read-only. */
export function probeCalls(account: string, symbols: string[]): Array<{ tool: string; args: Record<string, unknown> }> {
  const calls = [
    { tool: ACCOUNT_TOOL, args: {} },
    { tool: EQUITY.positions, args: positionsParams(account) },
    { tool: EQUITY.orders, args: { account_number: account } },
    { tool: QUOTE_TOOLS.equity, args: { symbols } },
  ];
  for (let i = 0; i < symbols.length; i += BOOK_SYMBOLS_PER_CALL) {
    calls.push({ tool: EQUITY.book, args: { symbols: symbols.slice(i, i + BOOK_SYMBOLS_PER_CALL) } });
  }
  return calls;
}

/** JSON Schema type name of one argument value this module sends. */
export type SentParamType = "string" | "array";

/**
 * Every tool this module calls, with each argument it sends and that argument's JSON type --
 * built by running the real argument builders above on sample values, so it cannot disagree
 * with what callTool() actually puts on the wire. Read by schema-check.ts (#26).
 */
export function expectedToolParams(): Map<string, Record<string, SentParamType>> {
  const sample: ApprovedOrder = { client_order_id: 1, instrument: "X", side: "buy", qty: "1", limit_price: "1", time_in_force: "ioc", request_id: "r" };
  const expected = new Map<string, Record<string, SentParamType>>();
  const add = (tool: string, args: Record<string, unknown>) => {
    const params = expected.get(tool) ?? {};
    for (const [name, value] of Object.entries(args)) {
      if (Array.isArray(value)) params[name] = "array";
      else if (typeof value === "string") params[name] = "string";
      else throw new Error(`expectedToolParams: ${tool}.${name} is a ${typeof value}; extend SentParamType`);
    }
    expected.set(tool, params);
  };
  add(EQUITY.place, placeParams("A", sample, "r"));
  add(EQUITY.preview, orderParams("A", sample));
  add(EQUITY.cancel, cancelParams("A", "o"));
  add(EQUITY.orders, cancelParams("A", "o")); // getOrderById sends the same two fields
  add(EQUITY.orders, withCursor(recentOrdersParams("A", "X", "d"), "c"));
  add(EQUITY.orders, withCursor(agenticOrdersParams("A"), "c"));
  add(EQUITY.positions, withCursor(positionsParams("A"), "c"));
  add(EQUITY.book, symbolsParams("X"));
  for (const tool of Object.values(QUOTE_TOOLS)) add(tool, symbolsParams("X"));
  add(ACCOUNT_TOOL, {});
  for (const probe of probeCalls("A", ["X"])) add(probe.tool, probe.args);
  return expected;
}

export interface CallOptions {
  /** Per-call request timeout in ms. A call that exceeds this throws; the gateway treats that as
   *  "outcome unknown" and looks the order up before ever sending it again. */
  timeoutMs?: number;
}

async function callTool(client: McpClient, tool: string, args: Record<string, unknown>, opts?: CallOptions): Promise<CallToolResult> {
  return client.callTool({ name: tool, arguments: args }, undefined, { timeout: opts?.timeoutMs }) as Promise<CallToolResult>;
}

/** Pulls the tool's structured payload out of a CallToolResult. Never guesses a default when
 *  the shape doesn't parse: an ambiguous response is a thrown error, same bucket as a transport
 *  failure. */
function unwrap(tool: string, result: CallToolResult): Record<string, unknown> {
  if (result.isError) {
    const text = result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
    throw new RobinhoodToolError(tool, text ?? "tool reported an error with no text content");
  }
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  const text = result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
  if (!text) throw new RobinhoodToolError(tool, "response has neither structuredContent nor text content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RobinhoodToolError(tool, "text content is not JSON");
  }
  if (!isRecord(parsed)) throw new RobinhoodToolError(tool, "response JSON is not an object");
  return parsed;
}

async function call(client: McpClient, tool: string, args: Record<string, unknown>, opts?: CallOptions) {
  return unwrap(tool, await callTool(client, tool, args, opts));
}

function asDecimalString(value: unknown): DecimalString | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listField(tool: string, body: Record<string, unknown>, field: string): unknown[] {
  const list = body[field];
  if (!Array.isArray(list)) {
    throw new RobinhoodToolError(tool, `expected a "${field}" array; response keys are [${Object.keys(body).join(", ")}]`);
  }
  return list;
}

const MAX_PAGES = 20;

/** Follows the `next` cursor the input schemas describe, bounded: more pages than that is an
 *  error rather than a silently partial list. */
async function listAll(client: McpClient, tool: string, args: Record<string, unknown>, field: string, opts?: CallOptions) {
  const items: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await call(client, tool, withCursor(args, cursor), opts);
    items.push(...listField(tool, body, field));
    if (typeof body.next !== "string" || body.next === "") return items;
    cursor = body.next;
  }
  throw new RobinhoodToolError(tool, `still paginating after ${MAX_PAGES} pages; refusing a partial list`);
}

// The states get_equity_orders' `state` filter description lists, in our vocabulary.
const ORDER_STATES: Record<string, PlaceOrderResult["status"]> = {
  new: "accepted",
  queued: "accepted",
  unconfirmed: "accepted",
  confirmed: "accepted",
  partially_filled: "partially_filled",
  filled: "filled",
  cancelled: "canceled",
  voided: "canceled",
  rejected: "rejected",
  failed: "rejected",
};

export interface VenueOrderRecord extends PlaceOrderResult {
  ref_id?: string;
}

/** One order object, from a place response or an orders list. An unknown state, or a fill with no
 *  parseable quantity and price, throws: those are exactly the "ambiguous response" case. */
function normalizeOrder(tool: string, body: unknown): VenueOrderRecord {
  if (!isRecord(body)) throw new RobinhoodToolError(tool, "order entry is not an object");
  const status = typeof body.state === "string" ? ORDER_STATES[body.state] : undefined;
  if (!status) throw new RobinhoodToolError(tool, `unrecognized order state: ${JSON.stringify(body.state)}`);
  const filled_qty = asDecimalString(body.filled_quantity);
  const avg_price = asDecimalString(body.average_price);
  if ((status === "filled" || status === "partially_filled") && (filled_qty === undefined || avg_price === undefined)) {
    throw new RobinhoodToolError(tool, `a ${status} order has no string filled_quantity/average_price`);
  }
  return {
    status,
    venue_order_id: typeof body.id === "string" ? body.id : undefined,
    ref_id: typeof body.ref_id === "string" ? body.ref_id : undefined,
    filled_qty,
    avg_price,
    reason: typeof body.reject_reason === "string" ? body.reject_reason : undefined,
    raw: body,
  };
}

/** Startup check: the configured account exists and allows agentic trading. Returns its entry. */
export async function verifyAgenticAccount(client: McpClient, account: string, opts?: CallOptions): Promise<Record<string, unknown>> {
  const accounts = listField(ACCOUNT_TOOL, await call(client, ACCOUNT_TOOL, {}, opts), "accounts");
  const entry = accounts.find((a): a is Record<string, unknown> => isRecord(a) && a.account_number === account);
  if (!entry) throw new RobinhoodToolError(ACCOUNT_TOOL, `${ACCOUNT_NUMBER_ENV} is not among the ${accounts.length} account(s) returned`);
  if (entry.agentic_allowed !== true) {
    throw new RobinhoodToolError(ACCOUNT_TOOL, `the ${ACCOUNT_NUMBER_ENV} account does not have agentic_allowed=true`);
  }
  return entry;
}

export async function previewOrder(client: McpClient, assetClass: AssetClass, account: string, order: ApprovedOrder, opts?: CallOptions): Promise<PreviewResult> {
  const tool = equityOnly(assetClass).preview;
  const raw = await call(client, tool, orderParams(account, order), opts);
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === "string") : [];
  return { warnings, raw };
}

export async function placeOrder(
  client: McpClient,
  assetClass: AssetClass,
  account: string,
  order: ApprovedOrder,
  refId: string,
  opts?: CallOptions,
): Promise<VenueOrderRecord> {
  const tool = equityOnly(assetClass).place;
  return normalizeOrder(tool, await call(client, tool, placeParams(account, order, refId), opts));
}

/** Sends the cancel. Its response shape is unverified, so callers never read it: the order's
 *  state from getOrderById() afterwards is what says whether the cancel took. */
export async function cancelOrder(client: McpClient, assetClass: AssetClass, account: string, venueOrderId: string, opts?: CallOptions): Promise<void> {
  const tool = equityOnly(assetClass).cancel;
  await call(client, tool, cancelParams(account, venueOrderId), opts);
}

export async function getOrderById(
  client: McpClient,
  assetClass: AssetClass,
  account: string,
  venueOrderId: string,
  opts?: CallOptions,
): Promise<OrderStatusResult> {
  const tool = equityOnly(assetClass).orders;
  const orders = listField(tool, await call(client, tool, cancelParams(account, venueOrderId), opts), "orders");
  if (orders.length === 0) return { status: "not_found", raw: null };
  if (orders.length > 1) throw new RobinhoodToolError(tool, `order_id filter returned ${orders.length} orders`);
  return normalizeOrder(tool, orders[0]);
}

/** After an ambiguous submit: this account's agentic orders for the symbol since `createdAtGte`,
 *  matched on our ref_id. undefined means none carries it. */
export async function findOrderByRefId(
  client: McpClient,
  assetClass: AssetClass,
  account: string,
  refId: string,
  symbol: string,
  createdAtGte: string,
  opts?: CallOptions,
): Promise<VenueOrderRecord | undefined> {
  const tool = equityOnly(assetClass).orders;
  const orders = await listAll(client, tool, recentOrdersParams(account, symbol, createdAtGte), "orders", opts);
  const matches = orders.filter((o) => isRecord(o) && o.ref_id === refId);
  if (matches.length > 1) throw new RobinhoodToolError(tool, `${matches.length} orders share one ref_id`);
  return matches.length === 1 ? normalizeOrder(tool, matches[0]) : undefined;
}

export async function getQuote(client: McpClient, assetClass: AssetClass, instrument: string, opts?: CallOptions): Promise<Record<string, unknown>> {
  return call(client, QUOTE_TOOLS[assetClass], symbolsParams(instrument), opts);
}

/** Thrown by getBook() for an asset class with no Level 2 tool (crypto). The recorder catches it
 *  to fall back to a top-of-book quote. */
export class BookUnsupportedError extends Error {
  constructor(public readonly assetClass: AssetClass) {
    super(`get_equity_price_book has no mapping for asset class "${assetClass}" (no L2 tool exists for it)`);
    this.name = "BookUnsupportedError";
  }
}

export interface BookResult {
  bids: BookLevel[];
  asks: BookLevel[];
  raw: Record<string, unknown>;
}

function normalizeBookLevels(tool: string, side: "bids" | "asks", raw: unknown): BookLevel[] {
  if (!Array.isArray(raw)) {
    throw new RobinhoodToolError(tool, `book response ${side} is not an array: ${JSON.stringify(raw)}`);
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new RobinhoodToolError(tool, `book response ${side}[${i}] is not an object: ${JSON.stringify(entry)}`);
    }
    const price = asDecimalString((entry as Record<string, unknown>).price);
    const qty = asDecimalString((entry as Record<string, unknown>).quantity);
    if (price === undefined || qty === undefined) {
      throw new RobinhoodToolError(tool, `book response ${side}[${i}] missing string price/quantity: ${JSON.stringify(entry)}`);
    }
    return { price, qty };
  });
}

/** Level 2 order book for one instrument. Levels are trusted to arrive best-first; a crossed or
 *  out-of-order snapshot is rejected downstream by qc_orderbook rather than reordered here. */
export async function getBook(client: McpClient, assetClass: AssetClass, instrument: string, opts?: CallOptions): Promise<BookResult> {
  if (assetClass !== "equity") throw new BookUnsupportedError(assetClass);
  const tool = EQUITY.book;
  const raw = await call(client, tool, symbolsParams(instrument), opts);
  const books = Array.isArray(raw.books) ? raw.books : [];
  const match = books.find(
    (b): b is Record<string, unknown> => typeof b === "object" && b !== null && (b as Record<string, unknown>).symbol === instrument,
  );
  if (!match) throw new RobinhoodToolError(tool, `no book entry for ${instrument} in response: ${JSON.stringify(raw)}`);
  return {
    bids: normalizeBookLevels(tool, "bids", match.bids),
    asks: normalizeBookLevels(tool, "asks", match.asks),
    raw: match,
  };
}

/** Every agentic order in the account, for issue #45's reconciliation. */
export async function listAgenticOrders(client: McpClient, assetClass: AssetClass, account: string, opts?: CallOptions): Promise<VenueOrderRecord[]> {
  const tool = equityOnly(assetClass).orders;
  const orders = await listAll(client, tool, agenticOrdersParams(account), "orders", opts);
  return orders.map((o) => normalizeOrder(tool, o));
}

/** Position and cash for issue #45's reconciliation. `position` is this instrument's held
 *  quantity; `cash` is the account entry's `cash` field if it has one (UNVERIFIED; qc-bridge does
 *  not compare cash yet). Re-checks agentic_allowed on every pass. */
export interface AccountState {
  position: DecimalString;
  cash: DecimalString | null;
}

export async function getAccountState(
  client: McpClient,
  assetClass: AssetClass,
  account: string,
  instrument: string,
  opts?: CallOptions,
): Promise<AccountState> {
  const tool = equityOnly(assetClass).positions;
  const positions = await listAll(client, tool, positionsParams(account), "positions", opts);
  const match = positions.filter((p): p is Record<string, unknown> => isRecord(p) && p.symbol === instrument);
  if (match.length > 1) throw new RobinhoodToolError(tool, `${match.length} positions for ${instrument}`);
  const position = match.length === 0 ? "0" : asDecimalString(match[0]!.quantity);
  if (position === undefined) throw new RobinhoodToolError(tool, `position for ${instrument} has no string quantity`);

  const entry = await verifyAgenticAccount(client, account, opts);
  return { position, cash: asDecimalString(entry.cash) ?? null };
}
