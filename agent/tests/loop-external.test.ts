// wave2-spec.md's `just agent-sim-external`: agent (fake) -> qc-bridge --venue external ->
// gateway -> mock Robinhood MCP -> report_execution, run twice with identical ledger and
// broker-journal hashes, exercising at least one partial fill, one reject, and one cancel. This
// is the same harness the justfile recipe uses (agent/src/testkit/run-external-sim.ts), called
// in-process here so this suite (agent-test, no shell-out) proves the same property.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runExternalSim } from "../src/testkit/run-external-sim.js";

describe("agent-sim-external: the full external-mode pipeline, twice", () => {
  it("produces identical ledger and broker-journal hashes across two independent runs", async () => {
    const first = await runExternalSim();
    const second = await runExternalSim();

    expect(first.ledgerSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.journalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second.ledgerSha256).toBe(first.ledgerSha256);
    expect(second.journalSha256).toBe(first.journalSha256);
  }, 20_000);

  it("exercises a partial fill, a reject, and a cancel", async () => {
    const result = await runExternalSim();
    const ledgerLines = readFileSync(result.ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const journalLines = readFileSync(result.journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

    const results = ledgerLines.map((e) => e.result as Record<string, unknown> | null).filter((r): r is Record<string, unknown> => r !== null);
    expect(results.some((r) => r.client_order_id === 1 && r.accepted === true)).toBe(true); // filled, exercised via journal below
    expect(results.some((r) => r.client_order_id === 3 && r.accepted === true)).toBe(true); // accepted at the bridge; rejected by the broker

    const resolvedByOrder = new Map<number, string>();
    for (const line of journalLines) {
      if (line.phase !== "resolved") continue;
      const result = line.result as { status: string };
      resolvedByOrder.set(line.client_order_id as number, result.status);
    }
    expect(resolvedByOrder.get(1)).toBe("filled");
    expect(resolvedByOrder.get(2)).toBe("partially_filled");
    expect(resolvedByOrder.get(3)).toBe("rejected");
    expect(resolvedByOrder.get(4)).toBe("canceled"); // accepted, then explicitly cancelled

    expect(result.counts.decisions).toBe(4);
    expect(result.counts.accepted).toBe(4); // all 4 accepted at the bridge; order 3's rejection is broker-side
  }, 20_000);
});
