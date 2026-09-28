// Reads market data through agent/src/broker/robinhood.ts's mapping functions (the gateway's
// Robinhood module interface -- wave2-spec lane D). Never imports place/cancel/preview from
// robinhood.ts, and every call is made through allowlist.ts's readOnly() wrapper.
//
// pollBook() (wave3-spec lane 5 / issue #43/#46 follow-up) is the recorder's main entry point:
// real Level 2 depth via get_equity_price_book when the asset class has one (equity), falling
// back to pollQuote()'s single top-of-book level when it doesn't (crypto/options --
// robinhood-agentic-mcp.md §2: "No equivalent Level 2 tool is listed for options or crypto").
// The fallback is flagged in BookSample.depth, never silent (root CLAUDE.md: no silent
// fallbacks) -- only robinhood.ts's own BookUnsupportedError (a documented structural gap, not
// an ambiguous/transport failure) triggers it; any other error from getBook still propagates.
import { BookUnsupportedError, getBook, getQuote } from "../broker/robinhood.js";
import type { McpClient } from "../broker/mcp-client.js";
import type { AssetClass, BookLevel, DecimalString } from "../broker/types.js";

export interface QuoteSample {
  bid: DecimalString;
  ask: DecimalString;
  /** Nanoseconds since epoch, millisecond precision (Date.now() * 1e6).
   *  ponytail: exchange timestamp is copied from localTsNs. Robinhood's get_equity_quotes /
   *  get_crypto_quotes response has no confirmed timestamp field -- UNVERIFIED per
   *  robinhood-agentic-mcp.md §2/§4 (schemas only visible by connecting a live client, #26),
   *  and the mock (agent/src/testkit/mock-robinhood-mcp.ts) returns none either. Clock-skew
   *  checks are therefore always zero for this field today; once a real/mock quote payload
   *  confirms an exchange timestamp, read it here instead of copying localTsNs. */
  exchangeTsNs: bigint;
  localTsNs: bigint;
  raw: Record<string, unknown>;
}

export function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

function firstQuote(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const quotes = raw.quotes;
  if (!Array.isArray(quotes)) return undefined;
  return quotes.find((q): q is Record<string, unknown> => typeof q === "object" && q !== null);
}

/** Polls one quote for `instrument` and returns the sample. Throws if the response doesn't
 *  parse -- same "ambiguous response is an error, never a guess" convention as robinhood.ts. */
export async function pollQuote(client: McpClient, assetClass: AssetClass, instrument: string): Promise<QuoteSample> {
  const localTsNs = nowNs();
  const raw = await getQuote(client, assetClass, instrument);
  const quote = firstQuote(raw);
  if (!quote) throw new Error(`quote tool returned no quote entry for ${instrument}: ${JSON.stringify(raw)}`);
  const { bid, ask } = quote;
  if (typeof bid !== "string" || typeof ask !== "string") {
    throw new Error(`quote tool response missing string bid/ask for ${instrument}: ${JSON.stringify(quote)}`);
  }
  return { bid, ask, exchangeTsNs: localTsNs, localTsNs, raw: quote };
}

/** One book level as pollBook() reports it. `qty` is present with a real resting size for an
 *  `"l2"` sample; absent for a `"top_of_book"` fallback sample, where the caller (record-writer's
 *  toSnapshotRecord) fills in the recorder's own configured placeholder -- the same convention
 *  pollQuote's single-level snapshot has always used. */
export interface PolledLevel {
  price: DecimalString;
  qty?: DecimalString;
}

export interface BookSample {
  bids: PolledLevel[];
  asks: PolledLevel[];
  /** "l2": real per-level resting size from get_equity_price_book. "top_of_book": no L2 tool
   *  for this asset class -- one level per side, price only, built from pollQuote(). */
  depth: "l2" | "top_of_book";
  exchangeTsNs: bigint;
  localTsNs: bigint;
  raw: Record<string, unknown>;
}

/** Polls the full order book for `instrument` when the venue publishes one for this asset class,
 *  or falls back to a single top-of-book level built from the quote tool when it doesn't. See
 *  the module header for which errors trigger the fallback and which still propagate. */
export async function pollBook(client: McpClient, assetClass: AssetClass, instrument: string): Promise<BookSample> {
  const localTsNs = nowNs();
  try {
    const book = await getBook(client, assetClass, instrument);
    return { bids: book.bids, asks: book.asks, depth: "l2", exchangeTsNs: localTsNs, localTsNs, raw: book.raw };
  } catch (err) {
    if (!(err instanceof BookUnsupportedError)) throw err;
  }
  const quote = await pollQuote(client, assetClass, instrument);
  return {
    bids: [{ price: quote.bid }],
    asks: [{ price: quote.ask }],
    depth: "top_of_book",
    exchangeTsNs: quote.exchangeTsNs,
    localTsNs: quote.localTsNs,
    raw: quote.raw,
  };
}

// Re-exported so callers only need one import for "a book level, real or placeholder-pending".
export type { BookLevel };
