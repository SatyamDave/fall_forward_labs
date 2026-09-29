// Fsync'd, append-only journal of every broker order-submission attempt (out/agent/broker-journal.jsonl
// by default, gitignored -- see agent/src/paths.ts's brokerJournalPath()). Required because
// BrokerGateway's in-memory idempotency map alone does not survive a process restart: if the process
// crashes between Robinhood receiving an order and this process learning the outcome, an in-memory-only
// map would forget the order was ever sent, and the next process would blind-resubmit it -- a real
// double order. recordAttempt() is written and fsync'd BEFORE the network call, with the ref_id that
// call carries, so after a crash the next process can look the order up by that ref_id (and, if it
// must resend, reuse it so Robinhood deduplicates). replayJournal() seeds BrokerGateway from this file.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import type { PlaceOrderResult } from "./types.js";

/** What BrokerGateway needs restored after a restart. "in_flight" is same-process only (an
 *  unresolved Promise cannot be persisted), so it replays as "unknown". `sends` counts the place
 *  calls already made for this order, so the resend bound survives a restart too. */
export type ReplayedOrderState =
  | { state: "unknown"; refId: string; sentAt: string; sends: number }
  | { state: "terminal"; refId: string; result: PlaceOrderResult };

interface AttemptEntry {
  phase: "attempt";
  client_order_id: number;
  ref_id: string;
  /** ISO 8601 time of the first send (bridge market clock), the lower bound for a lookup. */
  sent_at: string;
}

interface ResolvedEntry {
  phase: "resolved";
  client_order_id: number;
  ref_id: string;
  result: PlaceOrderResult;
}

type JournalEntry = AttemptEntry | ResolvedEntry;

// An entry without a ref_id (written before ref_id existed) fails closed: without it the order
// cannot be looked up, and resending under a new ref_id could double it.
function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.client_order_id !== "number" || typeof v.ref_id !== "string") return false;
  if (v.phase === "attempt") return typeof v.sent_at === "string";
  if (v.phase === "resolved") return typeof v.result === "object" && v.result !== null;
  return false;
}

export class Journal {
  constructor(private readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  private appendFsync(entry: JournalEntry): void {
    const fd = openSync(this.filePath, "a");
    try {
      writeSync(fd, `${JSON.stringify(entry)}\n`, null, "utf8");
      fsyncSync(fd); // durability: a crash right after this line still has the entry on disk
    } finally {
      closeSync(fd);
    }
  }

  /** Must be called BEFORE every place call, including a resend. */
  recordAttempt(clientOrderId: number, refId: string, sentAt: string): void {
    this.appendFsync({ phase: "attempt", client_order_id: clientOrderId, ref_id: refId, sent_at: sentAt });
  }

  /** Called once an outcome is known; `result.venue_order_id` is what cancels and lookups use. */
  recordResolved(clientOrderId: number, refId: string, result: PlaceOrderResult): void {
    this.appendFsync({ phase: "resolved", client_order_id: clientOrderId, ref_id: refId, result });
  }
}

export function openJournal(filePath: string): Journal {
  return new Journal(filePath);
}

/** Replays every line; the last entry per client_order_id wins. An id whose last entry is an
 *  attempt was sent with no confirmed outcome and comes back "unknown", which forces a lookup by
 *  ref_id before any resend. A corrupt or unrecognized line throws rather than being dropped. */
export function replayJournal(filePath: string): Map<number, ReplayedOrderState> {
  const out = new Map<number, ReplayedOrderState>();
  if (!existsSync(filePath)) return out;
  const sends = new Map<number, number>();
  const firstSentAt = new Map<number, string>();
  const lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.length > 0);
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`broker journal ${filePath} contains a corrupt line: ${line.slice(0, 200)}`);
    }
    if (!isJournalEntry(parsed)) {
      throw new Error(`broker journal ${filePath} contains an entry with an unrecognized shape: ${line.slice(0, 200)}`);
    }
    const id = parsed.client_order_id;
    if (parsed.phase === "attempt") {
      const count = (sends.get(id) ?? 0) + 1;
      sends.set(id, count);
      if (!firstSentAt.has(id)) firstSentAt.set(id, parsed.sent_at);
      out.set(id, { state: "unknown", refId: parsed.ref_id, sentAt: firstSentAt.get(id)!, sends: count });
    } else {
      out.set(id, { state: "terminal", refId: parsed.ref_id, result: parsed.result });
    }
  }
  return out;
}
