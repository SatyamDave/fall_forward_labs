#!/usr/bin/env node
// `just agent-sim-external` (wave2-spec.md, issue #45 + gateway-integration's wave2 scope):
// agent (fake decider) -> qc-bridge --venue external -> gateway -> mock Robinhood MCP ->
// report_execution, exercising at least one partial fill, one reject, and one cancel, and
// proving two independent runs produce identical ledger and broker-journal hashes.
//
// This is a testkit script, not agent/src/cli.ts: production cli.ts's connectRobinhoodMcp()
// only ever builds a real StreamableHTTPClientTransport (ROBINHOOD_MCP_URL required, no
// fallback -- hard limit: no real Robinhood connection), which is correct for cli.ts but would
// mean standing up a real local HTTP server just to run this repo-internal demo against the
// mock. Every other testkit file in this directory (fake-bridge.ts, fake-bridge-v12.ts,
// mock-robinhood-mcp.ts) already establishes the convention that test/demo wiring lives here,
// not in cli.ts -- this file follows it, wiring the exact same production pieces
// (BridgeClient, createExternalModeGateway, runLoop) to an in-memory MCP transport instead.
//
// Until wave2/bridge-control merges (this lane's own fake-bridge-v12.ts stands in for qc-bridge
// until then), see the PR body for how to point QC_BRIDGE_BIN at the real binary instead.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { BridgeClient } from "../bridge.js";
import { connectRobinhoodMcp } from "../broker/mcp-client.js";
import { createExternalModeGateway } from "../broker/external-mode.js";
import { FakeDecider } from "../decider/fake.js";
import { ledgerSha256 } from "../ledger.js";
import { runLoop } from "../loop.js";
import { repoRoot } from "../paths.js";
import { createMockRobinhoodServer, type MockScenario } from "./mock-robinhood-mcp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_SCENARIO = path.join(AGENT_ROOT, "tests", "fixtures", "external-sim-scenario.json");

/** client_order_id -> broker outcome, matching external-sim-scenario.json's 4 requests in
 *  order: a clean fill, a partial fill, a broker rejection, and one left open for an explicit
 *  cancel afterward -- "at least one partial fill, one reject, and one cancel" (wave2-spec.md). */
const SCENARIOS: Record<string, MockScenario> = {
  "1": "filled",
  "2": "partially_filled",
  "3": "rejected",
  "4": "accepted",
};

function sha256(filePath: string): string {
  const contents = existsSync(filePath) ? readFileSync(filePath) : Buffer.alloc(0);
  return createHash("sha256").update(contents).digest("hex");
}

export interface ExternalSimResult {
  ledgerPath: string;
  journalPath: string;
  ledgerSha256: string;
  journalSha256: string;
  counts: { decisions: number; accepted: number; rejected: number; noTrades: number };
}

export interface RunExternalSimOptions {
  scenarioPath?: string;
  /** Directory to write ledger.jsonl/broker-journal.jsonl into; defaults to a fresh temp dir per
   *  call so two calls in the same process (or two `just` invocations) never share state unless
   *  the caller asks them to. */
  outDir?: string;
}

export async function runExternalSim(opts: RunExternalSimOptions = {}): Promise<ExternalSimResult> {
  const outDir = opts.outDir ?? mkdtempSync(path.join(tmpdir(), "agent-sim-external-"));
  mkdirSync(outDir, { recursive: true });
  const ledgerPath = path.join(outDir, "ledger.jsonl");
  const journalPath = path.join(outDir, "broker-journal.jsonl");

  const bridgeScript = path.join(AGENT_ROOT, "src", "testkit", "fake-bridge-v12.ts");
  const tsxBin = path.join(AGENT_ROOT, "node_modules", ".bin", "tsx");
  const scenarioPath = opts.scenarioPath ?? DEFAULT_SCENARIO;

  const bridge = new BridgeClient({ command: tsxBin, args: [bridgeScript, "--venue", "external", "--scenario", scenarioPath] });
  bridge.start();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server: Server = createMockRobinhoodServer({
    scenarios: SCENARIOS,
    // No explicit `position`: the mock derives it from its own recorded fills (order 1 fills in
    // full, order 2 fills half, order 3 is rejected -- see mock-robinhood-mcp.ts), which is what
    // makes it agree with the bridge's OMS at both the startup reconcile (nothing placed yet,
    // position 0) and the one periodic reconcile this demo triggers (reconcileEveryNDecisions: 3,
    // below, lands right after client_order_id 3 resolves).
    cash: "10000.00",
  });
  await server.connect(serverTransport);
  const mcp = await connectRobinhoodMcp({ transport: clientTransport });

  try {
    const { gateway, reconcile } = await createExternalModeGateway({
      bridge,
      mcp,
      assetClass: "equity",
      instrument: "SPY",
      journalPath,
    });

    const counts = await runLoop({
      bridge,
      decider: new FakeDecider({ probThreshold: 0.5 }),
      mode: "fake",
      promptVersion: "v1",
      model: "fake-rule-v1",
      ledgerPath,
      // 3 (not the default 20): lands exactly once, right after client_order_id 3 resolves and
      // before client_order_id 4 is even placed -- see the mock server construction above for
      // why that specific landing point matters here.
      external: { gateway, assetClass: "equity", reconcile, reconcileEveryNDecisions: 3 },
    });

    // Exercise the cancel path explicitly: client_order_id 4 (scenario "accepted") is left open
    // by the loop itself -- nothing in today's loop auto-cancels an order, so this demo does it
    // the way a human or a future policy would, through the same protocol v1.2 op.
    const cancelResp = await bridge.cancelOrderIntent(4, "external-sim: demonstrating cancel_order_intent");
    if (!cancelResp.ok || !cancelResp.result?.approval) {
      throw new Error(`cancel_order_intent for client_order_id 4 failed: ${JSON.stringify(cancelResp.error ?? cancelResp.result)}`);
    }
    await gateway.cancelOrder(4, "SPY", "equity", cancelResp.result.approval);

    return {
      ledgerPath,
      journalPath,
      ledgerSha256: ledgerSha256(ledgerPath),
      journalSha256: sha256(journalPath),
      counts,
    };
  } finally {
    await mcp.close();
    await server.close();
    await bridge.shutdown();
  }
}

async function main(): Promise<void> {
  const first = await runExternalSim();
  const second = await runExternalSim();

  console.log(`run 1: decisions=${JSON.stringify(first.counts)} ledger=${first.ledgerSha256} journal=${first.journalSha256}`);
  console.log(`run 2: decisions=${JSON.stringify(second.counts)} ledger=${second.ledgerSha256} journal=${second.journalSha256}`);

  // Keep the latest run's artifacts where other tooling (evals, CI) looks for them, same
  // convention as justfile's agent-sim recipe.
  mkdirSync(path.join(repoRoot(), "out", "agent"), { recursive: true });
  const outLedger = path.join(repoRoot(), "out", "agent", "ledger.jsonl");
  const outJournal = path.join(repoRoot(), "out", "agent", "broker-journal.jsonl");
  const fs = await import("node:fs");
  fs.copyFileSync(second.ledgerPath, outLedger);
  fs.copyFileSync(second.journalPath, outJournal);

  if (first.ledgerSha256 !== second.ledgerSha256) {
    throw new Error(`FAIL: agent-sim-external ledger is not deterministic (${first.ledgerSha256} != ${second.ledgerSha256})`);
  }
  if (first.journalSha256 !== second.journalSha256) {
    throw new Error(`FAIL: agent-sim-external broker journal is not deterministic (${first.journalSha256} != ${second.journalSha256})`);
  }
  console.log("agent-sim-external deterministic across two runs (ledger and broker journal)");
}

// Only run as a CLI when invoked directly (`tsx run-external-sim.ts`), not when imported by a
// test (agent/tests/loop-external.test.ts calls runExternalSim() directly, in-process).
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
