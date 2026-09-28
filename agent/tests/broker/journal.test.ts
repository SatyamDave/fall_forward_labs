// The fsync'd append-only journal (#35 review finding: the in-memory idempotency map alone does
// not survive a process restart). Unit-level: does replay reconstruct the right state from the
// file alone, with no BrokerGateway involved. See gateway.test.ts for the end-to-end
// crash-after-send / restart test.
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openJournal, replayJournal } from "../../src/broker/journal.js";
import type { PlaceOrderResult } from "../../src/broker/types.js";

function tempJournalPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "broker-journal-unit-"));
  return path.join(dir, "broker-journal.jsonl");
}

const FILLED: PlaceOrderResult = { status: "filled", venue_order_id: "SYN-1", filled_qty: "10", avg_price: "500.00", raw: {} };

describe("broker journal", () => {
  it("replays empty for a journal that was never written", () => {
    expect(replayJournal(tempJournalPath())).toEqual(new Map());
  });

  it("an attempt with no resolved entry replays as unknown -- the crash-after-send case", () => {
    const filePath = tempJournalPath();
    openJournal(filePath).recordAttempt(1);

    expect(replayJournal(filePath)).toEqual(new Map([[1, { state: "unknown" }]]));
  });

  it("an attempt followed by resolved replays as terminal with the resolved result", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(2);
    journal.recordResolved(2, FILLED);

    expect(replayJournal(filePath)).toEqual(new Map([[2, { state: "terminal", result: FILLED }]]));
  });

  it("keeps only the last entry per client_order_id across multiple ids", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(1);
    journal.recordAttempt(2);
    journal.recordResolved(1, FILLED);
    // 2 never resolves -- still unknown after replay.

    const replayed = replayJournal(filePath);
    expect(replayed.get(1)).toEqual({ state: "terminal", result: FILLED });
    expect(replayed.get(2)).toEqual({ state: "unknown" });
  });

  it("writes one JSON line per entry and fsyncs (readable immediately, never truncates)", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(1);
    journal.recordResolved(1, FILLED);

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ phase: "attempt", client_order_id: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ phase: "resolved", client_order_id: 1 });
  });

  it("fails closed on a corrupt line rather than silently dropping it", () => {
    const filePath = tempJournalPath();
    openJournal(filePath).recordAttempt(1);
    appendFileSync(filePath, "not json\n");

    expect(() => replayJournal(filePath)).toThrow(/corrupt/);
  });
});
