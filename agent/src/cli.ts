#!/usr/bin/env node
// Entry point: QC_BRIDGE_BIN spawns qc-bridge (or a stand-in speaking the same protocol,
// e.g. src/testkit/fake-bridge.ts); QC_AGENT_MODE picks the decider. Runs the loop to feed
// exhaustion, then prints counts and the ledger sha256 (see justfile `agent-sim`).
//
// External venue mode (protocol v1.2, issue #45 + wave2-spec.md): after the bridge starts, this
// always calls hello() to find out which venue mode it's in. venue_mode "external" additionally
// connects to Robinhood (agent/src/broker/mcp-client.js's connectRobinhoodMcp -- requires
// ROBINHOOD_MCP_URL; this repo's hard limit is no real Robinhood connection, so that env var is
// never set for a real run here, and this path is exercised only against the mock in tests/
// `just agent-sim-external`) and wires agent/src/broker/external-mode.js's
// createExternalModeGateway() into the loop. Today's build supports exactly one instrument
// (wave2-spec.md's gap list: "Bridge supports one hard-coded instrument"), so QC_INSTRUMENT
// names it rather than this file guessing.
import path from "node:path";
import { createExternalModeGateway } from "./broker/external-mode.js";
import { connectRobinhoodMcp } from "./broker/mcp-client.js";
import type { AssetClass } from "./broker/types.js";
import { BridgeClient } from "./bridge.js";
import { FakeDecider } from "./decider/fake.js";
import { LiveDecider, PROMPT_VERSION } from "./decider/live.js";
import { loadReplayFixtures, ReplayDecider } from "./decider/replay.js";
import type { Decider } from "./decider/types.js";
import { ledgerSha256 } from "./ledger.js";
import { type ExternalModeLoopOptions, runLoop } from "./loop.js";
import { repoRoot } from "./paths.js";
import type { LedgerMode } from "./types.js";

function resolveAssetClass(raw: string | undefined): AssetClass {
  if (raw === "crypto") return "crypto";
  if (raw === undefined || raw === "equity") return "equity";
  throw new Error(`QC_ASSET_CLASS must be "equity" or "crypto", got ${JSON.stringify(raw)}`);
}

/** Builds the external-mode loop wiring when the bridge's hello handshake reports venue_mode
 *  "external"; undefined (sim mode, unchanged behavior) otherwise. */
async function maybeBuildExternalMode(bridge: BridgeClient): Promise<ExternalModeLoopOptions | undefined> {
  const helloResp = await bridge.hello();
  if (!helloResp.ok) {
    // hello is optional (protocol v1.1+, schemas/decision/v1/README.md: "a v1-only session ...
    // is byte-for-byte unchanged") -- a bridge that doesn't implement it yet is plain v1/sim,
    // not an error. Only a bridge that DOES answer hello and explicitly says "external" gets the
    // external-mode wiring below.
    return undefined;
  }
  if (helloResp.hello?.venue_mode !== "external") return undefined;

  const instrument = process.env.QC_INSTRUMENT;
  if (!instrument) {
    throw new Error("bridge reported venue_mode external but QC_INSTRUMENT is not set: refusing to guess an instrument");
  }
  const assetClass = resolveAssetClass(process.env.QC_ASSET_CLASS);
  const mcp = await connectRobinhoodMcp();
  const { gateway, reconcile, heartbeat } = await createExternalModeGateway({
    bridge,
    mcp,
    assetClass,
    instrument,
    onHalted: (reason) => {
      // No logging convention exists in agent/ yet (cli.ts's own broker/gateway.ts precedent);
      // stderr is the best available signal until one does.
      console.error(`heartbeat observed the bridge halted (${reason}): draining pending cancels`);
    },
  });
  heartbeat.start();
  return { gateway, assetClass, reconcile, heartbeat };
}

function resolveMode(raw: string | undefined): LedgerMode {
  if (raw === "live") return "live";
  if (raw === "replay") return "replay";
  return "fake";
}

async function main(): Promise<void> {
  const mode: LedgerMode = resolveMode(process.env.QC_AGENT_MODE);

  const bridgeBin = process.env.QC_BRIDGE_BIN;
  if (!bridgeBin) {
    throw new Error(
      "QC_BRIDGE_BIN is not set: point it at the qc-bridge binary, or at a stand-in " +
        "process speaking the same JSON Lines protocol (e.g. src/testkit/fake-bridge.ts).",
    );
  }
  const bridgeArgs = (process.env.QC_BRIDGE_ARGS ?? "").split(" ").filter(Boolean);

  const bridge = new BridgeClient({ command: bridgeBin, args: bridgeArgs });
  bridge.start();
  const external = await maybeBuildExternalMode(bridge);

  // A lower threshold only exists to drive the order path in smoke runs (`just agent-sim`);
  // it says nothing about whether a trade is worth making.
  const rawThreshold = process.env.QC_FAKE_PROB_THRESHOLD;
  const probThreshold = rawThreshold === undefined ? undefined : Number(rawThreshold);
  if (probThreshold !== undefined && !(probThreshold > 0 && probThreshold <= 1)) {
    throw new Error(`QC_FAKE_PROB_THRESHOLD must be in (0, 1], got ${rawThreshold}`);
  }
  const decider: Decider =
    mode === "live"
      ? new LiveDecider()
      : mode === "replay"
        ? new ReplayDecider(
            loadReplayFixtures(
              process.env.QC_REPLAY_FIXTURES_DIR ?? path.join(repoRoot(), "agent", "fixtures", "replay"),
            ),
          )
        : new FakeDecider({ probThreshold });
  const model =
    mode === "live" ? (process.env.ANTHROPIC_MODEL ?? "unspecified") : mode === "replay" ? "replay-fixture" : "fake-rule-v1";

  try {
    const counts = await runLoop({ bridge, decider, mode, promptVersion: PROMPT_VERSION, model, external });
    console.log(
      `decisions=${counts.decisions} accepted=${counts.accepted} rejected=${counts.rejected} no_trade=${counts.noTrades}`,
    );
    console.log(`ledger sha256: ${ledgerSha256()}`);
  } finally {
    external?.heartbeat?.stop();
    await bridge.shutdown();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
