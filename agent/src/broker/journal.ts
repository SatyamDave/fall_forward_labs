// Fsync'd, append-only journal of every broker order-submission attempt (out/agent/broker-journal.jsonl
// by default, gitignored -- see agent/src/paths.ts's brokerJournalPath()). Required because
// BrokerGateway's in-memory idempotency map alone does not survive a process restart: if the process
// crashes between Robinhood receiving an order and this process learning the outcome, an in-memory-only
// map would forget the order was ever sent, and the next process would blind-resubmit it -- a real
// double order. This file exists so that never happens: recordAttempt() is written and fsync'd BEFORE
// the network call, so a crash after send always leaves a durable trace, and replayJournal() is read
// at BrokerGateway construction to seed the in-memory map with exactly that trace.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import type { PlaceOrderResult } from "./types.js";

/** What BrokerGateway's own OrderState needs restored after a restart -- deliberately only the
 *  two variants that can be true before a client ever calls submitOrder again ("in_flight" is a
 *  same-process-only concept, an unresolved Promise cannot be persisted). */
export type ReplayedOrderState = { state: "unknown" } | { state: "terminal"; result: PlaceOrderResult };

interface AttemptEntry {
  phase: "attempt";
  client_order_id: number;
}

interface ResolvedEntry {
  phase: "resolved";
  client_order_id: number;
  result: PlaceOrderResult;
}

type JournalEntry = AttemptEntry | ResolvedEntry;

function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.client_order_id !== "number") return false;
  if (v.phase === "attempt") return true;
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

  /** Must be called BEFORE the placeOrder network call -- this is the record that makes a
   *  crash-after-send safe to reconcile instead of forgotten. */
  recordAttempt(clientOrderId: number): void {
    this.appendFsync({ phase: "attempt", client_order_id: clientOrderId });
  }

  /** Called once an outcome is actually known (placed, or reconciled via a status query). */
  recordResolved(clientOrderId: number, result: PlaceOrderResult): void {
    this.appendFsync({ phase: "resolved", client_order_id: clientOrderId, result });
  }
}

export function openJournal(filePath: string): Journal {
  return new Journal(filePath);
}

/** Replays every line, keeping only the LAST entry per client_order_id (the journal is
 *  append-only, so a later line always supersedes an earlier one for the same id). A
 *  client_order_id whose last entry is "attempt" -- sent, outcome never confirmed by this
 *  process -- comes back as "unknown", the same state attemptSubmit's own catch block uses to
 *  force reconcile() (a status query) before ever calling placeOrder again. A corrupt or
 *  unrecognized line fails closed (throws) rather than silently dropping a record that might be
 *  the only thing standing between a restart and a duplicate order. */
export function replayJournal(filePath: string): Map<number, ReplayedOrderState> {
  const out = new Map<number, ReplayedOrderState>();
  if (!existsSync(filePath)) return out;
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
    if (parsed.phase === "attempt") {
      out.set(parsed.client_order_id, { state: "unknown" });
    } else {
      out.set(parsed.client_order_id, { state: "terminal", result: parsed.result });
    }
  }
  return out;
}
