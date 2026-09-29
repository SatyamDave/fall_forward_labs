// The only file in agent/src/broker/ that knows how to reach an MCP server over the wire.
// @modelcontextprotocol/sdk is pinned to an exact version in agent/package.json (no ^ or ~),
// same convention as this package's other dependencies. Streamable HTTP transport, URL from
// env -- never a literal Robinhood URL in this codebase (hard limit: no real Robinhood
// connection). Never imported by agent/src/decider/**: enforced by
// agent/tests/broker/no-decider-import.test.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { storedAuthTransport } from "./robinhood-oauth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { CallToolResult };

/** The subset of the SDK Client that robinhood.ts actually calls -- narrowed so tests can hand
 *  in anything that satisfies this shape without constructing a full Client. */
export type McpClient = Pick<Client, "callTool" | "connect" | "close">;

export const ROBINHOOD_MCP_URL_ENV = "ROBINHOOD_MCP_URL";

export interface ConnectOptions {
  /** Injected in tests (e.g. one half of an InMemoryTransport.createLinkedPair()). Production
   *  always builds a fresh StreamableHTTPClientTransport from ROBINHOOD_MCP_URL below. */
  transport?: Transport;
  clientVersion?: string;
}

/** Fails closed: refuses to guess a broker URL. There is no default/fallback endpoint on
 *  purpose -- a missing env var must be a startup error, not a silently-wrong connection. */
export async function connectRobinhoodMcp(opts: ConnectOptions = {}): Promise<Client> {
  const client = new Client({ name: "fall-forward-labs-broker-gateway", version: opts.clientVersion ?? "0.1.0" });
  const transport = opts.transport ?? (await defaultTransport());
  await client.connect(transport);
  return client;
}

async function defaultTransport(): Promise<Transport> {
  const url = process.env[ROBINHOOD_MCP_URL_ENV];
  if (!url) {
    throw new Error(`${ROBINHOOD_MCP_URL_ENV} is not set -- refusing to guess a broker URL`);
  }
  return storedAuthTransport(url);
}
