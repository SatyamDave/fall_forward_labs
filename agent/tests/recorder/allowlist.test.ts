// Unit-level proof of issue #46's "the recorder can only read prices": readOnly() must let a
// quote tool through untouched and must throw -- before ever reaching the underlying client --
// for anything else, order/cancel/preview tools included.
import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "../../src/broker/mcp-client.js";
import { OrderToolCalledError, READ_ONLY_TOOLS, readOnly } from "../../src/recorder/allowlist.js";

function stubClient(): { client: McpClient; callTool: ReturnType<typeof vi.fn> } {
  const callTool = vi.fn().mockResolvedValue({ content: [], structuredContent: { ok: true } });
  const client = {
    callTool,
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpClient;
  return { client, callTool };
}

describe("readOnly()", () => {
  it("lets every READ_ONLY_TOOLS name through to the underlying client", async () => {
    for (const tool of READ_ONLY_TOOLS) {
      const { client, callTool } = stubClient();
      const wrapped = readOnly(client);
      await wrapped.callTool({ name: tool, arguments: {} });
      expect(callTool).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["place_equity_order", "cancel_equity_order", "place_crypto_order", "cancel_crypto_order", "review_equity_order", "preview_crypto_order", "get_equity_orders"])(
    "throws OrderToolCalledError for %s without ever calling the underlying client",
    async (tool) => {
      const { client, callTool } = stubClient();
      const wrapped = readOnly(client);
      await expect(wrapped.callTool({ name: tool, arguments: {} })).rejects.toThrow(OrderToolCalledError);
      expect(callTool).not.toHaveBeenCalled();
    },
  );

  it("throws for a missing/non-string tool name instead of guessing", async () => {
    const { client, callTool } = stubClient();
    const wrapped = readOnly(client);
    // @ts-expect-error -- deliberately malformed params, same "ambiguous is an error" convention
    await expect(wrapped.callTool({})).rejects.toThrow(OrderToolCalledError);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("passes connect/close through unchanged", async () => {
    const { client } = stubClient();
    const wrapped = readOnly(client);
    await wrapped.connect({} as never);
    await wrapped.close();
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
