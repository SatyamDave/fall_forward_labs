// Entry point for `just robinhood-schema-check` (#26). Default target is the in-process mock
// (agent/src/testkit/mock-robinhood-mcp.ts) over an InMemoryTransport: no network. The real
// server is reached only with `--target real`, which also needs ROBINHOOD_MCP_URL
// (mcp-client.ts refuses to guess a URL). Exit 0 only when everything robinhood.ts depends on
// matches; 1 on any mismatch or error.
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { repoRoot } from "../paths.js";
import { createMockRobinhoodServer } from "../testkit/mock-robinhood-mcp.js";
import { connectRobinhoodMcp } from "./mcp-client.js";
import { expectedToolParams } from "./robinhood.js";
import { parseTarget, runSchemaCheck } from "./schema-check.js";

async function main(): Promise<number> {
  const target = parseTarget(process.argv.slice(2));
  let client: Client;
  if (target === "real") {
    client = await connectRobinhoodMcp();
  } else {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMockRobinhoodServer().connect(serverTransport);
    client = await connectRobinhoodMcp({ transport: clientTransport });
  }
  try {
    const { outPath, toolCount, problems } = await runSchemaCheck(client, target, path.join(repoRoot(), "out", "robinhood"));
    console.log(`listed ${toolCount} tools from the ${target} server; wrote ${outPath}`);
    if (problems.length === 0) {
      console.log(`OK: every tool and parameter robinhood.ts depends on matches (${expectedToolParams().size} tools checked)`);
      return 0;
    }
    console.log(`MISMATCH: ${problems.length} problem(s); robinhood.ts needs updating before any real order:`);
    for (const p of problems) console.log(`  - ${p}`);
    return 1;
  } finally {
    await client.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`schema check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
