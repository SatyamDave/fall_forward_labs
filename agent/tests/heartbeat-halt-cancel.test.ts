// Issue #44 reopened ("Stop everything even if the agent itself is stuck"): the two safety gaps
// the security review found, each proved end to end against the REAL qc-bridge binary and a mock
// Robinhood broker:
//
//   1. A hung (alive but stuck) decision loop never calls the bridge again -- so its own kill-file
//      polling (engine/crates/bridge/src/wire.rs's per-op check) would never fire if nothing else
//      called it either. agent/src/broker/heartbeat.ts's Heartbeat is the fix: a real wall-clock
//      timer, independent of runLoop's own await chain, that keeps polling `status` regardless.
//      This test hangs the decider on purpose and proves the heartbeat still observes the halt
//      within budget, printing the measured latency.
//   2. A halt in external mode moves every open order to PendingCancel at the bridge but (before
//      this PR) minted no approval for it, so the gateway had no signed authorization to actually
//      cancel it at the broker -- real-bridge-halts.test.ts's own header comment flagged this
//      exact gap. This test places several orders, kills the bridge, and proves the heartbeat
//      drains protocol v1.2.1's `pending_cancels` and finishes every cancel at the mock broker,
//      exactly once per order, deterministically across two independent runs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge.js";
import { createExternalModeGateway } from "../src/broker/external-mode.js";
import { connectRobinhoodMcp } from "../src/broker/mcp-client.js";
import { FakeDecider } from "../src/decider/fake.js";
import type { Decider, DecisionOutcome } from "../src/decider/types.js";
import { ledgerSha256RedactingApprovalSignatures } from "../src/ledger.js";
import { runLoop } from "../src/loop.js";
import { resolveRealBridgeBin } from "../src/testkit/real-bridge-bin.js";
import { writeRealBridgeFixtures } from "../src/testkit/real-bridge-fixtures.js";
import { createMockRobinhoodServer } from "../src/testkit/mock-robinhood-mcp.js";

/** A decider whose decide() call never resolves -- standing in for a live LLM call that hangs,
 *  or any other stuck decision loop. Deliberately not awaited by its caller in either test below:
 *  the whole point is that nothing downstream of it ever gets a chance to run again. */
class HungDecider implements Decider {
  decide(): Promise<DecisionOutcome> {
    return new Promise<DecisionOutcome>(() => undefined);
  }
}

function sha256(filePath: string): string {
  const contents = existsSync(filePath) ? readFileSync(filePath) : Buffer.alloc(0);
  return createHash("sha256").update(contents).digest("hex");
}

interface Harness {
  bridge: BridgeClient;
  mcp: Awaited<ReturnType<typeof connectRobinhoodMcp>>;
  server: Server;
  killFile: string;
  cancelCalls: () => number;
  stop: () => Promise<void>;
}

/** Spawns the real qc-bridge (--venue external --kill-file, decide_every=1) plus a mock
 *  Robinhood MCP server, and wires createExternalModeGateway on top -- the same three pieces
 *  run-external-sim.ts already assembles for `just agent-sim-external`, with a kill file and a
 *  fast heartbeat interval added for these tests. */
async function startHarness(
  dir: string,
  opts: { journalPath: string; scenarios?: Record<string, "accepted"> },
): Promise<Harness & { external: Awaited<ReturnType<typeof createExternalModeGateway>> }> {
  const fixtures = writeRealBridgeFixtures(path.join(dir, "fixtures"));
  const killFile = path.join(dir, "kill");
  const bridge = new BridgeClient({
    command: resolveRealBridgeBin(),
    args: [
      fixtures.recordingPath,
      "--limits",
      fixtures.limitsPath,
      "--model",
      fixtures.modelPath,
      "--model-sha256",
      fixtures.modelSha256,
      "--decide-every",
      "1",
      "--venue",
      "external",
      "--kill-file",
      killFile,
    ],
  });
  bridge.start();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let cancelCalls = 0;
  const server = createMockRobinhoodServer({
    scenarios: opts.scenarios,
    cash: "10000.00",
    onToolCall: (name) => {
      if (name === "cancel_equity_order" || name === "cancel_crypto_order") cancelCalls += 1;
    },
  });
  await server.connect(serverTransport);
  const mcp = await connectRobinhoodMcp({ transport: clientTransport });

  const external = await createExternalModeGateway({
    bridge,
    mcp,
    assetClass: "equity",
    instrument: "1",
    journalPath: opts.journalPath,
    heartbeatIntervalMs: 25,
  });

  return {
    bridge,
    mcp,
    server,
    killFile,
    cancelCalls: () => cancelCalls,
    external,
    stop: async () => {
      external.heartbeat.stop();
      await mcp.close();
      await server.close();
      await bridge.shutdown();
    },
  };
}

describe("heartbeat observes a halt even when the decision loop is stuck (issue #44 reopened)", () => {
  it("reports halted within budget while decider.decide() never returns, and measures the latency", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "heartbeat-hang-"));
    const journalPath = path.join(dir, "broker-journal.jsonl");
    const harness = await startHarness(dir, { journalPath });

    try {
      // Fire-and-forget on purpose: HungDecider never resolves, so this promise never settles.
      // The point of this test is that nothing about it being stuck matters to the heartbeat.
      void runLoop({
        bridge: harness.bridge,
        decider: new HungDecider(),
        mode: "fake",
        promptVersion: "v1",
        model: "fake-rule-v1",
        ledgerPath: path.join(dir, "ledger.jsonl"),
        external: { gateway: harness.external.gateway, assetClass: "equity", reconcile: harness.external.reconcile },
      });

      // Give the (now permanently stuck) loop a moment to actually reach the hang -- proves this
      // isn't just "the heartbeat won the race before the loop did anything at all".
      await new Promise((resolve) => setTimeout(resolve, 100));

      harness.external.heartbeat.start();
      const touchedAt = Date.now();
      writeFileSync(harness.killFile, "");

      const deadline = Date.now() + 5_000;
      while (!harness.external.heartbeat.isHalted && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const latencyMs = Date.now() - touchedAt;
      console.log(`heartbeat observed halted ${latencyMs}ms after the kill file was written`);

      expect(harness.external.heartbeat.isHalted).toBe(true);
      // CLAUDE.md rule 11's one-second budget, from the moment the file appeared to the
      // heartbeat's own status() call reporting it -- not from process start.
      expect(latencyMs).toBeLessThan(1_000);
    } finally {
      await harness.stop();
    }
  }, 20_000);
});

describe("heartbeat finishes halt-triggered cancels at the real broker (issue #44 reopened)", () => {
  async function runKillScenario(label: string): Promise<{ ledgerSha256: string; journalSha256: string; cancelCalls: number }> {
    const dir = mkdtempSync(path.join(tmpdir(), `heartbeat-kill-${label}-`));
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const journalPath = path.join(dir, "broker-journal.jsonl");
    const harness = await startHarness(dir, {
      journalPath,
      // Every order stays "accepted" (resting, unfilled) at the mock broker -- if any filled or
      // was rejected there'd be nothing left open for the kill to need to cancel.
      scenarios: { "1": "accepted", "2": "accepted", "3": "accepted", "4": "accepted" },
    });

    try {
      const counts = await runLoop({
        bridge: harness.bridge,
        decider: new FakeDecider({ probThreshold: 0.5 }),
        mode: "fake",
        promptVersion: "v1",
        model: "fake-rule-v1",
        ledgerPath,
        external: {
          gateway: harness.external.gateway,
          assetClass: "equity",
          reconcile: harness.external.reconcile,
          reconcileEveryNDecisions: 1_000, // only the startup reconcile matters for this test
        },
      });
      expect(counts.accepted).toBe(4); // sanity: all 4 orders open at the broker, none resolved yet

      harness.external.heartbeat.start();
      writeFileSync(harness.killFile, "");

      const deadline = Date.now() + 5_000;
      let allClosed = false;
      while (Date.now() < deadline) {
        const status = await harness.bridge.status();
        const open = status.status?.open_orders ?? [];
        if (status.status?.halted && open.length === 0) {
          allClosed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(allClosed).toBe(true);

      return {
        ledgerSha256: ledgerSha256RedactingApprovalSignatures(ledgerPath),
        journalSha256: sha256(journalPath),
        cancelCalls: harness.cancelCalls(),
      };
    } finally {
      await harness.stop();
    }
  }

  it("cancels every open order at the broker within the timeout, exactly once each, deterministically across two runs", async () => {
    const first = await runKillScenario("1");
    const second = await runKillScenario("2");

    expect(first.cancelCalls).toBe(4);
    expect(second.cancelCalls).toBe(4);
    expect(second.ledgerSha256).toBe(first.ledgerSha256);
    expect(second.journalSha256).toBe(first.journalSha256);
  }, 30_000);
});
