// The poll loop: pulls one quote every pollIntervalMs, up to requestBudget requests total, and
// writes each as a Snapshot record. Rate limits for the real Agentic MCP endpoint are UNVERIFIED
// (robinhood-agentic-mcp.md §4, issue #27) -- requestBudget is the recorder's own conservative
// cap until a real limit is confirmed, not a measured one.
import type { McpClient } from "../broker/mcp-client.js";
import type { AssetClass, DecimalString } from "../broker/types.js";
import { pollQuote } from "./poll.js";
import { toSnapshotRecord, type RecordWriter } from "./record-writer.js";

export interface SessionOptions {
  client: McpClient;
  assetClass: AssetClass;
  symbol: string;
  instrumentId: number;
  pollIntervalMs: number;
  requestBudget: number;
  placeholderQty: DecimalString;
  writer: RecordWriter;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Set (e.g. by a SIGINT/SIGTERM handler) to stop early and still finalize cleanly. */
  signal?: AbortSignal;
}

export interface SessionResult {
  requestsMade: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the poll loop to completion (budget exhausted, or `signal` aborted between polls). */
export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const sleep = opts.sleep ?? defaultSleep;
  let seq = 0;
  let requestsMade = 0;
  while (requestsMade < opts.requestBudget) {
    if (opts.signal?.aborted) break;
    requestsMade++;
    const sample = await pollQuote(opts.client, opts.assetClass, opts.symbol);
    seq++;
    opts.writer.writeSnapshot(toSnapshotRecord(sample, opts.instrumentId, seq, opts.placeholderQty));
    if (requestsMade >= opts.requestBudget || opts.signal?.aborted) break;
    await sleep(opts.pollIntervalMs);
  }
  return { requestsMade };
}
