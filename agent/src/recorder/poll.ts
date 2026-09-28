// Reads one quote through agent/src/broker/robinhood.ts's existing getQuote() mapping (the
// gateway's Robinhood module interface -- wave2-spec lane D). Never imports place/cancel/preview
// from robinhood.ts, and every call is made through allowlist.ts's readOnly() wrapper.
//
// Level 2 (get_equity_price_book) is out of scope here: robinhood.ts's TOOLS table (the one
// module that owns Robinhood tool names) has no price-book mapping today, so there is nothing
// for this poller to call for it. Once that mapping grows one (gateway/gateway-integration
// lanes' territory, not this one's), a pollBook() alongside pollQuote() is the natural addition.
import { getQuote } from "../broker/robinhood.js";
import type { McpClient } from "../broker/mcp-client.js";
import type { AssetClass, DecimalString } from "../broker/types.js";

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
