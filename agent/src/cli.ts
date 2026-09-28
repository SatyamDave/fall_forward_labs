#!/usr/bin/env node
// Entry point: QC_BRIDGE_BIN spawns qc-bridge (or a stand-in speaking the same protocol,
// e.g. src/testkit/fake-bridge.ts); QC_AGENT_MODE picks the decider. Runs the loop to feed
// exhaustion, then prints counts and the ledger sha256 (see justfile `agent-sim`).
import path from "node:path";
import { BridgeClient } from "./bridge.js";
import { FakeDecider } from "./decider/fake.js";
import { LiveDecider, PROMPT_VERSION } from "./decider/live.js";
import { loadReplayFixtures, ReplayDecider } from "./decider/replay.js";
import type { Decider } from "./decider/types.js";
import { ledgerSha256 } from "./ledger.js";
import { runLoop } from "./loop.js";
import { repoRoot } from "./paths.js";
import type { LedgerMode } from "./types.js";

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
    const counts = await runLoop({ bridge, decider, mode, promptVersion: PROMPT_VERSION, model });
    console.log(
      `decisions=${counts.decisions} accepted=${counts.accepted} rejected=${counts.rejected} no_trade=${counts.noTrades}`,
    );
    console.log(`ledger sha256: ${ledgerSha256()}`);
  } finally {
    await bridge.shutdown();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
