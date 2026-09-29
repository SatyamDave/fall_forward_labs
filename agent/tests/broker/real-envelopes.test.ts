// Every Robinhood read parser against the REAL response envelope, `{ "data": {...}, "guide": str }`,
// recorded by the read-only probe on 2026-09-29 (docs/research/robinhood-shapes-2026-09-29.json).
// The fixture holds synthetic values in exactly those shapes; the first test proves it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "../../src/broker/mcp-client.js";
import { lastTradePrices, shapeOf } from "../../src/broker/probe-readonly.js";
import { getAccountState, getBook, getOrderById, getQuote, listAgenticOrders, verifyAgenticAccount } from "../../src/broker/robinhood.js";
import { repoRoot } from "../../src/paths.js";
import { MAX_BOOK_LEVELS, pollBook } from "../../src/recorder/poll.js";

type Body = Record<string, unknown>;
const FIXTURE = JSON.parse(readFileSync(path.join(repoRoot(), "agent", "fixtures", "robinhood", "real-envelopes.json"), "utf8")) as Record<string, Body>;
const RECORDED = JSON.parse(readFileSync(path.join(repoRoot(), "docs", "research", "robinhood-shapes-2026-09-29.json"), "utf8")) as {
  calls: Array<{ tool: string; shape: unknown }>;
};
const ACCOUNT = "SYNTH0001";

function fixtureClient(overrides: Record<string, Body> = {}): McpClient {
  return {
    callTool: vi.fn(async ({ name }: { name: string }) => ({ content: [], structuredContent: structuredClone(overrides[name] ?? FIXTURE[name]) })),
  } as unknown as McpClient;
}

function withAccount(changes: Body): Body {
  const body = structuredClone(FIXTURE.get_accounts!) as { data: { accounts: Body[] } };
  Object.assign(body.data.accounts[0]!, changes);
  return body;
}

describe("real Robinhood response envelopes", () => {
  it("the fixture has exactly the shapes the real probe recorded", () => {
    for (const { tool, shape } of RECORDED.calls) expect(shapeOf(FIXTURE[tool], new Set()), tool).toEqual(shape);
  });

  it("get_accounts: the configured account passes only if agentic_allowed and not deactivated", async () => {
    await expect(verifyAgenticAccount(fixtureClient(), ACCOUNT)).resolves.toMatchObject({ account_number: ACCOUNT });
    await expect(verifyAgenticAccount(fixtureClient(), "SYNTH0002")).rejects.toThrow(/agentic_allowed=true/);
    await expect(verifyAgenticAccount(fixtureClient(), "MISSING1")).rejects.toThrow(/not among the 2 account/);
    for (const changes of [{ deactivated: true }, { permanently_deactivated: true }, { deactivated: "false" }, { permanently_deactivated: undefined }]) {
      await expect(verifyAgenticAccount(fixtureClient({ get_accounts: withAccount(changes) }), ACCOUNT)).rejects.toThrow(/deactivated/);
    }
  });

  it("get_equity_positions: an empty real list is a zero position, and real accounts carry no cash field", async () => {
    await expect(getAccountState(fixtureClient(), "equity", ACCOUNT, "SPY")).resolves.toEqual({ position: "0", cash: null });
    const unknownEntry = { data: { positions: [{ instrument: "https://example.invalid/SYNTHETIC", quantity: "1" }] }, guide: "g" };
    await expect(getAccountState(fixtureClient({ get_equity_positions: unknownEntry }), "equity", ACCOUNT, "SPY")).rejects.toThrow(/position entry/);
  });

  it("get_equity_orders: an empty real list parses, by id and in full", async () => {
    await expect(listAgenticOrders(fixtureClient(), "equity", ACCOUNT)).resolves.toEqual([]);
    await expect(getOrderById(fixtureClient(), "equity", ACCOUNT, "SYNTHETIC-ID")).resolves.toMatchObject({ status: "not_found" });
  });

  it("get_equity_quotes: bid, ask and last come from data.results[].quote as decimal strings", async () => {
    await expect(getQuote(fixtureClient(), "equity", "SPY")).resolves.toMatchObject({ bid: "100.000000", ask: "100.050000", last: "100.020000" });
    await expect(getQuote(fixtureClient(), "equity", "SPLG")).rejects.toThrow(/no quote for SPLG/);
    expect(lastTradePrices(FIXTURE.get_equity_quotes, ["SPY", "SPLG"])).toEqual(
      new Map([
        ["SPY", "100.020000"],
        ["SPLG", "not found (see the shapes file)"],
      ]),
    );
    const noBid = structuredClone(FIXTURE.get_equity_quotes!) as { data: { results: Array<{ quote: Body }> } };
    noBid.data.results[0]!.quote.bid_price = null;
    await expect(getQuote(fixtureClient({ get_equity_quotes: noBid }), "equity", "SPY")).rejects.toThrow(/bid_price/);
  });

  it("get_equity_price_book: real levels carry quantity as an integer share count", async () => {
    const book = (bids: unknown[]) => ({ data: { books: [{ symbol: "SPY", updated_at: "t", asks: [], bids }] }, guide: "g" });
    await expect(getBook(fixtureClient({ get_equity_price_book: book([{ price: "15.880000", quantity: 30957 }]) }), "equity", "SPY")).resolves.toMatchObject({
      bids: [{ price: "15.880000", qty: "30957" }],
    });
    for (const quantity of [1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(getBook(fixtureClient({ get_equity_price_book: book([{ price: "15.88", quantity }]) }), "equity", "SPY")).rejects.toThrow(/price\/quantity/);
    }
  });

  it("pollBook keeps only the best MAX_BOOK_LEVELS per side, as qc-bridge requires", async () => {
    const levels = (n: number, start: number, step: number) =>
      Array.from({ length: n }, (_, i) => ({ price: (start + i * step).toFixed(2), quantity: 100 }));
    const deep = { data: { books: [{ symbol: "SPY", updated_at: "t", bids: levels(543, 15.88, -0.01), asks: levels(1428, 15.89, 0.01) }] }, guide: "g" };
    const sample = await pollBook(fixtureClient({ get_equity_price_book: deep }), "equity", "SPY");
    expect(sample.depth).toBe("l2");
    expect(sample.bids).toHaveLength(MAX_BOOK_LEVELS);
    expect(sample.asks).toHaveLength(MAX_BOOK_LEVELS);
    expect(sample.bids[0]).toMatchObject({ price: "15.88" });
    expect(sample.asks[0]).toMatchObject({ price: "15.89" });
  });

  it("get_equity_price_book: empty real levels fall back to the flagged top of book from the quote, never invented levels", async () => {
    await expect(getBook(fixtureClient(), "equity", "SPY")).resolves.toMatchObject({ bids: [], asks: [] });
    const sample = await pollBook(fixtureClient(), "equity", "SPY");
    expect(sample.depth).toBe("top_of_book");
    expect(sample.bids).toEqual([{ price: "100.000000" }]);
    expect(sample.asks).toEqual([{ price: "100.050000" }]);
  });

  it("a response outside the envelope throws instead of being read", async () => {
    const bare = { accounts: (FIXTURE.get_accounts!.data as Body).accounts };
    await expect(verifyAgenticAccount(fixtureClient({ get_accounts: bare }), ACCOUNT)).rejects.toThrow(/"data"/);
    const extra = { ...FIXTURE.get_equity_orders!, next: "SYNTHETIC-CURSOR" };
    await expect(listAgenticOrders(fixtureClient({ get_equity_orders: extra }), "equity", ACCOUNT)).rejects.toThrow(/next/);
  });
});
