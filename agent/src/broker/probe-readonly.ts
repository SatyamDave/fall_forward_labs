// `just robinhood-probe-readonly` (#26): calls the five read-only tools in robinhood.ts's
// PROBE_TOOLS once each and records what their responses LOOK like, so the response parsing in
// robinhood.ts (UNVERIFIED today) can be checked against the real server.
//
// Output 1, out/robinhood/shapes-<date>.json: for each call, the response's keys and JSON types
// only. Every value is replaced by its type; object keys that could themselves be data (the
// account number, a requested symbol, anything with 5+ digits or a UUID) are replaced too.
// Output 2, stdout: each requested symbol's last-trade price from get_equity_quotes. Market
// prices are public, not account data; nothing else from any response is printed.
//
// The client is wrapped in mcp-client.ts's allowOnly(PROBE_TOOLS), so a place, cancel or
// preview call throws before it reaches the wire (agent/tests/broker/probe-readonly.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { repoRoot } from "../paths.js";
import { createMockRobinhoodServer, MOCK_ACCOUNT_NUMBER } from "../testkit/mock-robinhood-mcp.js";
import { allowOnly, connectRobinhoodMcp, type CallToolResult, type McpClient } from "./mcp-client.js";
import { accountNumberFromEnv, PROBE_TOOLS, probeCalls } from "./robinhood.js";

/** SPY plus low-priced broad-market ETF CANDIDATES for the first trade under the $25/order cap.
 *  Listed as candidates only: this file makes no claim about their prices; the probe prints them. */
export const DEFAULT_PROBE_SYMBOLS = ["SPY", "SPLG", "SCHB", "SCHX", "SPTM"];

const CALL_TIMEOUT_MS = 10_000;

export type Shape = string | Shape[] | { [key: string]: Shape };

/** Keys + JSON types of `value`, with every value dropped. Arrays keep one entry per distinct
 *  element shape (never their length). */
export function shapeOf(value: unknown, sensitiveKeys: ReadonlySet<string>): Shape {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const distinct = new Map<string, Shape>();
    for (const item of value) {
      const shape = shapeOf(item, sensitiveKeys);
      distinct.set(JSON.stringify(shape), shape);
    }
    return [...distinct.values()];
  }
  if (typeof value === "object") {
    const out: Record<string, Shape> = {};
    let redacted = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = sensitiveKeys.has(key) || /\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key) ? `<redacted-key-${++redacted}>` : key;
      out[safeKey] = shapeOf(v, sensitiveKeys);
    }
    return out;
  }
  return typeof value; // "string" | "number" | "boolean"
}

function body(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return "<non-JSON text>";
  }
}

/** Last-trade price per symbol from a get_equity_quotes body, or why it could not be read. The
 *  key name `last_trade_price` is a guess (UNVERIFIED); the shapes file shows the real one. */
export function lastTradePrices(quotesBody: unknown, symbols: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const quotes = typeof quotesBody === "object" && quotesBody !== null ? (quotesBody as Record<string, unknown>).quotes : undefined;
  for (const symbol of symbols) {
    const quote = Array.isArray(quotes)
      ? quotes.find((q): q is Record<string, unknown> => typeof q === "object" && q !== null && (q as Record<string, unknown>).symbol === symbol)
      : undefined;
    const price = quote?.last_trade_price;
    out.set(symbol, typeof price === "string" && /^[0-9]+(\.[0-9]+)?$/.test(price) ? price : "not found (see the shapes file)");
  }
  return out;
}

export interface ProbeResult {
  shapes: Array<{ tool: string; ok: boolean; shape: Shape }>;
  prices: Map<string, string>;
  failures: number;
}

export async function runProbe(client: McpClient, account: string, symbols: string[]): Promise<ProbeResult> {
  const guarded = allowOnly(client, PROBE_TOOLS);
  const sensitive = new Set([account, ...symbols]);
  const shapes: ProbeResult["shapes"] = [];
  let quotesBody: unknown;
  let failures = 0;
  for (const { tool, args } of probeCalls(account, symbols)) {
    try {
      const result = (await guarded.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })) as CallToolResult;
      const parsed = body(result);
      if (result.isError) failures += 1;
      // An error's text is never written: it could echo the account back.
      shapes.push({ tool, ok: !result.isError, shape: result.isError ? "<tool error; text not recorded>" : shapeOf(parsed, sensitive) });
      if (tool === "get_equity_quotes" && !result.isError) quotesBody = parsed;
    } catch (err) {
      failures += 1;
      shapes.push({ tool, ok: false, shape: `<call failed: ${err instanceof Error ? err.name : "error"}>` });
    }
  }
  return { shapes, prices: lastTradePrices(quotesBody, symbols), failures };
}

export function parseProbeArgs(argv: string[]): { target: "mock" | "real"; symbols: string[] } {
  let target: "mock" | "real" = "mock";
  let symbols = DEFAULT_PROBE_SYMBOLS;
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--target" && (value === "mock" || value === "real")) target = value;
    else if (flag === "--symbols" && value && /^[A-Z.]{1,10}(,[A-Z.]{1,10}){0,19}$/.test(value)) symbols = value.split(",");
    else throw new Error(`usage: robinhood-probe-readonly [--target mock|real] [--symbols SPY,SPLG,...] (max 20), got: ${argv.join(" ")}`);
  }
  return { target, symbols };
}

async function main(): Promise<number> {
  const { target, symbols } = parseProbeArgs(process.argv.slice(2));
  let client: McpClient;
  let account: string;
  if (target === "real") {
    account = accountNumberFromEnv();
    client = await connectRobinhoodMcp();
  } else {
    account = MOCK_ACCOUNT_NUMBER;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMockRobinhoodServer().connect(serverTransport);
    client = await connectRobinhoodMcp({ transport: clientTransport });
  }
  try {
    const now = new Date();
    const result = await runProbe(client, account, symbols);
    const outDir = path.join(repoRoot(), "out", "robinhood");
    const outPath = path.join(outDir, target === "real" ? `shapes-${now.toISOString().slice(0, 10)}.json` : `shapes-${now.toISOString().slice(0, 10)}.mock.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, `${JSON.stringify({ target, probed_at: now.toISOString(), calls: result.shapes }, null, 2)}\n`);
    console.log(`wrote response shapes (values redacted) to ${outPath}`);
    const label = target === "mock" ? " (SYNTHETIC mock price)" : "";
    for (const [symbol, price] of result.prices) console.log(`${symbol} last_trade_price=${price}${label}`);
    if (result.failures > 0) console.log(`${result.failures} call(s) failed; see the shapes file`);
    return result.failures === 0 ? 0 : 1;
  } finally {
    await client.close();
  }
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
