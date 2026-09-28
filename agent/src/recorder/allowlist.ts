// Issue #46: "the recorder can only read prices -- it holds no credential that could place a
// trade." This module is how that's enforced in code, not just in the recorder's own call
// sites: every Robinhood tool call the recorder makes goes through readOnly(), which throws
// before a non-read-only tool name ever reaches the wire. agent/tests/recorder/allowlist.test.ts
// fails if an order/cancel/preview tool is ever called through this wrapper.
import type { McpClient } from "../broker/mcp-client.js";

// Robinhood's published quote tools (robinhood-agentic-mcp.md §2), plus get_equity_price_book
// (Level 2, wave3-spec lane 5 / issue #43/#46 follow-up): a read-only market-data tool, now
// mapped in agent/src/broker/robinhood.ts's TOOLS table and called by
// agent/src/recorder/poll.ts's pollBook() for the equity asset class.
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "get_equity_quotes",
  "get_crypto_quotes",
  "get_equity_price_book",
]);

export class OrderToolCalledError extends Error {
  constructor(public readonly tool: string) {
    super(
      `recorder attempted to call "${tool}", which is not on the read-only allowlist ` +
        `(${[...READ_ONLY_TOOLS].join(", ")}). The recorder must never place, cancel, or ` +
        "preview an order -- refusing before the call reaches the wire.",
    );
    this.name = "OrderToolCalledError";
  }
}

function toolName(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Wraps a real McpClient so every callTool() is checked against READ_ONLY_TOOLS first.
 * connect()/close() pass through untouched; only callTool is gated.
 */
export function readOnly(client: McpClient): McpClient {
  return {
    connect: (...args: Parameters<McpClient["connect"]>) => client.connect(...args),
    close: (...args: Parameters<McpClient["close"]>) => client.close(...args),
    // async, not a plain arrow returning client.callTool(...): a synchronous throw here would
    // throw immediately at the call site instead of rejecting the returned promise, which would
    // break every caller (robinhood.ts, tests) that treats callTool() as always promise-returning.
    callTool: async (...args: Parameters<McpClient["callTool"]>) => {
      const name = toolName(args[0]);
      if (!name || !READ_ONLY_TOOLS.has(name)) {
        throw new OrderToolCalledError(name ?? "<unnamed tool>");
      }
      return client.callTool(...args);
    },
  };
}
