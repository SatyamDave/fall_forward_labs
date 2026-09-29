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

const FILLED: PlaceOrderResult = { status: "filled", venue_order_id: "00000000-0000-4000-8000-000000000001", filled_qty: "1", avg_price: "20.00", raw: {} };
const REF = "11111111-1111-5111-8111-111111111111";
const SENT = "2026-09-29T14:30:00.000Z";

describe("broker journal", () => {
  it("replays empty for a journal that was never written", () => {
    expect(replayJournal(tempJournalPath())).toEqual(new Map());
  });

  it("an attempt with no resolved entry replays as unknown -- the crash-after-send case", () => {
    const filePath = tempJournalPath();
    openJournal(filePath).recordAttempt(1, REF, SENT);

    expect(replayJournal(filePath)).toEqual(new Map([[1, { state: "unknown", refId: REF, sentAt: SENT, sends: 1 }]]));
  });

  it("counts every send across a restart and keeps the first send time as the lookup bound", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(1, REF, SENT);
    journal.recordAttempt(1, REF, "2026-09-29T14:30:05.000Z");

    expect(replayJournal(filePath).get(1)).toEqual({ state: "unknown", refId: REF, sentAt: SENT, sends: 2 });
  });

  it("an entry without a ref_id fails closed: it could not be looked up", () => {
    const filePath = tempJournalPath();
    appendFileSync(filePath, `${JSON.stringify({ phase: "attempt", client_order_id: 1, sent_at: SENT })}\n`);

    expect(() => replayJournal(filePath)).toThrow(/unrecognized shape/);
  });

  it("an attempt followed by resolved replays as terminal with the resolved result", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(2, REF, SENT);
    journal.recordResolved(2, REF, FILLED);

    // The venue order id survives the restart: cancels and status reads use it.
    expect(replayJournal(filePath)).toEqual(new Map([[2, { state: "terminal", refId: REF, result: FILLED }]]));
  });

  it("keeps only the last entry per client_order_id across multiple ids", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(1, REF, SENT);
    journal.recordAttempt(2, "r2", SENT);
    journal.recordResolved(1, REF, FILLED);
    // 2 never resolves -- still unknown after replay.

    const replayed = replayJournal(filePath);
    expect(replayed.get(1)).toEqual({ state: "terminal", refId: REF, result: FILLED });
    expect(replayed.get(2)).toEqual({ state: "unknown", refId: "r2", sentAt: SENT, sends: 1 });
  });

  it("writes one JSON line per entry and fsyncs (readable immediately, never truncates)", () => {
    const filePath = tempJournalPath();
    const journal = openJournal(filePath);
    journal.recordAttempt(1, REF, SENT);
    journal.recordResolved(1, REF, FILLED);

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ phase: "attempt", client_order_id: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ phase: "resolved", client_order_id: 1 });
  });

  it("fails closed on a corrupt line rather than silently dropping it", () => {
    const filePath = tempJournalPath();
    openJournal(filePath).recordAttempt(1, REF, SENT);
    appendFileSync(filePath, "not json\n");

    expect(() => replayJournal(filePath)).toThrow(/corrupt/);
  });
});
