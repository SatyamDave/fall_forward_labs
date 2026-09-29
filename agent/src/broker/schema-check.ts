// `just robinhood-schema-check` (#26, #43): lists the tools a Robinhood MCP server reports and
// checks them against the tool names and arguments robinhood.ts sends. It only ever sends
// tools/list: runSchemaCheck() takes a client typed without callTool, so it cannot call a tool
// and therefore cannot place, preview or cancel an order (agent/tests/broker/schema-check.test.ts
// also proves no tools/call reaches the server).
//
// The command-line entry point, and the choice of mock or real server, is schema-check-cli.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { expectedToolParams, type SentParamType } from "./robinhood.js";

export type Target = "mock" | "real";
type ListOnlyClient = Pick<Client, "listTools">;

const MAX_PAGES = 50;

export async function listAllTools(client: ListOnlyClient): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (cursor === undefined) return tools;
  }
  throw new Error(`tools/list still paginating after ${MAX_PAGES} pages; refusing to report a partial list`);
}

/** JSON Schema types a property accepts, or undefined when the schema does not constrain it. */
function acceptedTypes(schema: unknown): string[] | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const s = schema as { type?: unknown; anyOf?: unknown; oneOf?: unknown };
  if (typeof s.type === "string") return [s.type];
  if (Array.isArray(s.type)) return s.type.filter((t): t is string => typeof t === "string");
  const branches = Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : undefined;
  if (!branches) return undefined;
  const types: string[] = [];
  for (const branch of branches) {
    const t = acceptedTypes(branch);
    if (t === undefined) return undefined; // one untyped branch accepts anything
    types.push(...t);
  }
  return types;
}

/** One plain-language line per way the listed tools disagree with what robinhood.ts sends.
 *  Empty means every tool and argument we depend on matches. */
export function compareToolSchemas(listed: Tool[], expected: Map<string, Record<string, SentParamType>>): string[] {
  const byName = new Map(listed.map((t) => [t.name, t]));
  const problems: string[] = [];
  for (const [toolName, params] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    const tool = byName.get(toolName);
    if (!tool) {
      problems.push(`${toolName}: tool is missing from the server's tool list`);
      continue;
    }
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
    for (const [param, sentType] of Object.entries(params)) {
      if (!Object.hasOwn(properties, param)) {
        problems.push(`${toolName}: we send parameter "${param}", but the server's schema has no such parameter`);
        continue;
      }
      const types = acceptedTypes(properties[param]);
      if (types && !types.includes(sentType)) {
        problems.push(`${toolName}: parameter "${param}" is sent as ${sentType}, but the server expects ${types.join(" or ")}`);
      }
    }
    for (const required of tool.inputSchema.required ?? []) {
      if (!Object.hasOwn(params, required)) {
        problems.push(`${toolName}: the server requires parameter "${required}", which we never send`);
      }
    }
  }
  return problems;
}

export interface SchemaCheckResult {
  outPath: string;
  toolCount: number;
  problems: string[];
}

/** Lists tools, writes their names and input schemas (nothing else: no descriptions, no URL, no
 *  account data) to out/robinhood/, and compares them with robinhood.ts's expectations. */
export async function runSchemaCheck(client: ListOnlyClient, target: Target, outDir: string, now = new Date()): Promise<SchemaCheckResult> {
  const tools = await listAllTools(client);
  const date = now.toISOString().slice(0, 10);
  // A mock run gets its own file name so it never overwrites a real dump taken the same day.
  const outPath = path.join(outDir, target === "real" ? `tools-${date}.json` : `tools-${date}.mock.json`);
  mkdirSync(outDir, { recursive: true });
  const dump = {
    target,
    listed_at: now.toISOString(),
    tools: tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(outPath, `${JSON.stringify(dump, null, 2)}\n`);
  return { outPath, toolCount: tools.length, problems: compareToolSchemas(tools, expectedToolParams()) };
}

export function parseTarget(argv: string[]): Target {
  if (argv.length === 0) return "mock";
  if (argv.length === 2 && argv[0] === "--target" && (argv[1] === "mock" || argv[1] === "real")) return argv[1];
  throw new Error(`usage: schema-check [--target mock|real], got: ${argv.join(" ")}`);
}
