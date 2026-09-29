// `just robinhood-schema-check` (#26) against the mock Robinhood MCP server over a real MCP
// handshake: a matching server passes, a renamed tool or parameter fails with a plain message,
// and the check never sends tools/call (so it cannot place an order).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { expectedToolParams } from "../../src/broker/robinhood.js";
import { parseTarget, runSchemaCheck } from "../../src/broker/schema-check.js";
import { createMockRobinhoodServer, type MockRobinhoodOptions } from "../../src/testkit/mock-robinhood-mcp.js";

async function check(listTools?: MockRobinhoodOptions["listTools"]) {
  const toolCalls: string[] = [];
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMockRobinhoodServer({ listTools, onToolCall: (name) => toolCalls.push(name) }).connect(serverTransport);
  const client = await connectRobinhoodMcp({ transport: clientTransport });
  const outDir = mkdtempSync(path.join(tmpdir(), "rh-schema-"));
  try {
    const result = await runSchemaCheck(client, "mock", outDir, new Date("2026-09-28T12:00:00Z"));
    return { ...result, toolCalls };
  } finally {
    await client.close();
  }
}

describe("robinhood schema check", () => {
  it("passes against the matching mock and writes only names and input schemas", async () => {
    const { problems, toolCalls, outPath, toolCount } = await check();
    expect(problems).toEqual([]);
    expect(toolCalls).toEqual([]);
    expect(path.basename(outPath)).toBe("tools-2026-09-28.mock.json");
    const dump = JSON.parse(readFileSync(outPath, "utf8"));
    expect(dump.tools).toHaveLength(toolCount);
    for (const tool of dump.tools) expect(Object.keys(tool).sort()).toEqual(["inputSchema", "name"]);
    // Every tool robinhood.ts calls is checked, not just the order tools.
    expect(expectedToolParams().size).toBe(14);
  });

  it("fails naming a tool the server renamed", async () => {
    const { problems, toolCalls } = await check((tools) =>
      tools.map((t) => (t.name === "place_equity_order" ? { ...t, name: "submit_equity_order" } : t)),
    );
    expect(problems).toEqual(["place_equity_order: tool is missing from the server's tool list"]);
    expect(toolCalls).toEqual([]);
  });

  it("fails naming a parameter the server renamed, and the required one we don't send", async () => {
    const { problems, toolCalls } = await check((tools) =>
      tools.map((t) => {
        if (t.name !== "review_equity_order") return t;
        const { quantity, ...rest } = t.inputSchema.properties!;
        return { ...t, inputSchema: { ...t.inputSchema, properties: { ...rest, qty: quantity! }, required: ["symbol", "side", "qty"] } };
      }),
    );
    expect(problems).toEqual([
      'review_equity_order: we send parameter "quantity", but the server\'s schema has no such parameter',
      'review_equity_order: the server requires parameter "qty", which we never send',
    ]);
    expect(toolCalls).toEqual([]);
  });

  it("fails on a type mismatch", async () => {
    const { problems } = await check((tools) =>
      tools.map((t) =>
        t.name === "place_crypto_order"
          ? { ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, quantity: { type: "number" } } } }
          : t,
      ),
    );
    expect(problems).toEqual(['place_crypto_order: parameter "quantity" is sent as string, but the server expects number']);
  });

  it("defaults to the mock and reaches the real server only with an explicit flag", () => {
    expect(parseTarget([])).toBe("mock");
    expect(parseTarget(["--target", "real"])).toBe("real");
    expect(() => parseTarget(["--real"])).toThrow(/usage/);
  });
});
