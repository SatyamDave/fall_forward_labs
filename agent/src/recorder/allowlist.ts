// Issue #46: "the recorder can only read prices -- it holds no credential that could place a
// trade." This module is how that's enforced in code, not just in the recorder's own call
// sites: every Robinhood tool call the recorder makes goes through readOnly(), which throws
// before a non-read-only tool name ever reaches the wire. agent/tests/recorder/allowlist.test.ts
// fails if an order/cancel/preview tool is ever called through this wrapper.
import { allowOnly, OrderToolCalledError, type McpClient } from "../broker/mcp-client.js";

// Robinhood's published quote tools (robinhood-agentic-mcp.md §2), plus get_equity_price_book
// (Level 2, wave3-spec lane 5 / issue #43/#46 follow-up): a read-only market-data tool, now
// mapped in agent/src/broker/robinhood.ts's TOOLS table and called by
// agent/src/recorder/poll.ts's pollBook() for the equity asset class.
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "get_equity_quotes",
  "get_crypto_quotes",
  "get_equity_price_book",
]);

export { OrderToolCalledError };

/** Wraps a real McpClient so every callTool() is checked against READ_ONLY_TOOLS first. */
export function readOnly(client: McpClient): McpClient {
  return allowOnly(client, READ_ONLY_TOOLS);
}
