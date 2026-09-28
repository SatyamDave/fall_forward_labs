// Writes recorder output in exactly the record format engine/crates/gateway/src/record.rs
// parses (the same format as tests/replay/sample_day.csv):
//   S,<instrument>,<seq>,<ts_exchange>,<ts_local>,<bids>,<asks>   snapshot
// `bids`/`asks` are `price@qty;price@qty...`, best level first. Prices/quantities are the fixed-
// point decimal strings qc_core::Price/Qty::from_str accepts (plain decimal, <=8 fraction
// digits, no exponent -- never a float). Every write is fsync'd before the next one, same
// durability convention as agent/src/broker/journal.ts: a crash mid-recording must never lose an
// already-appended line.
//
// Only Snapshot ("S") records are produced. Delta ("D") and Trade ("T") lines are real,
// documented parts of the format (record.rs), but this recorder has no source for them: quote
// polling (poll.ts) gives a fresh top-of-book snapshot each call, not an incremental book delta
// or a trade tape, and fabricating either from a quote poll would be recording data that was
// never actually observed. Emitting only what was genuinely seen matters more than a full record
// mix; a future L2/trade-feed source (see poll.ts's header) is what would add D/T lines.
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import type { DecimalString } from "../broker/types.js";
import type { QuoteSample } from "./poll.js";

export interface SnapshotRecord {
  instrument: number;
  seq: number;
  tsExchangeNs: bigint;
  tsLocalNs: bigint;
  bidPrice: DecimalString;
  bidQty: DecimalString;
  askPrice: DecimalString;
  askQty: DecimalString;
}

/** Builds the SnapshotRecord for one poll. `placeholderQty` fills the level size: Robinhood's
 *  quote tools return no confirmed book depth (poll.ts's header) -- the mock returns none either
 *  -- so every level uses this fixed, documented placeholder rather than fabricating a specific
 *  observed size. `seq` must be caller-assigned and strictly increasing per instrument. */
export function toSnapshotRecord(sample: QuoteSample, instrument: number, seq: number, placeholderQty: DecimalString): SnapshotRecord {
  return {
    instrument,
    seq,
    tsExchangeNs: sample.exchangeTsNs,
    tsLocalNs: sample.localTsNs,
    bidPrice: sample.bid,
    bidQty: placeholderQty,
    askPrice: sample.ask,
    askQty: placeholderQty,
  };
}

export function formatSnapshot(r: SnapshotRecord): string {
  return `S,${r.instrument},${r.seq},${r.tsExchangeNs},${r.tsLocalNs},${r.bidPrice}@${r.bidQty},${r.askPrice}@${r.askQty}`;
}

/** Append-only writer for one recording session. Not thread-safe / not for concurrent writers --
 *  one recorder process owns one output file. */
export class RecordWriter {
  private readonly fd: number;
  private readonly records: SnapshotRecord[] = [];

  constructor(
    public readonly filePath: string,
    headerLines: readonly string[] = [],
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = openSync(filePath, "w");
    for (const line of headerLines) {
      writeSync(this.fd, `# ${line}\n`);
    }
    fsyncSync(this.fd);
  }

  writeSnapshot(record: SnapshotRecord): void {
    writeSync(this.fd, `${formatSnapshot(record)}\n`);
    fsyncSync(this.fd);
    this.records.push(record);
  }

  /** Every snapshot written so far, in write order -- what quality.ts and catalog.ts run over. */
  get written(): readonly SnapshotRecord[] {
    return this.records;
  }

  close(): void {
    closeSync(this.fd);
  }
}
