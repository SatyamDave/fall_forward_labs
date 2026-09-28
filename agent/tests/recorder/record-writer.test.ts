// Proves the exact text this recorder writes matches engine/crates/gateway/src/record.rs's
// grammar byte for byte: `S,<instrument>,<seq>,<ts_exchange>,<ts_local>,<bids>,<asks>`, one level
// per side as `price@qty`. The real proof that a whole file parses is
// agent/tests/recorder/replay-integration.test.ts (runs it through the actual qc-replay binary);
// this test pins the per-line format so a regression here is caught without a Rust build.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatSnapshot, RecordWriter, toSnapshotRecord, type SnapshotRecord } from "../../src/recorder/record-writer.js";
import type { QuoteSample } from "../../src/recorder/poll.js";

describe("formatSnapshot", () => {
  it("matches record.rs's S,<instrument>,<seq>,<ts_exchange>,<ts_local>,<bids>,<asks> grammar", () => {
    const record: SnapshotRecord = {
      instrument: 1,
      seq: 42,
      tsExchangeNs: 1767571200266000000n,
      tsLocalNs: 1767571200266700396n,
      bidPrice: "65000.10000000",
      bidQty: "1.00000000",
      askPrice: "65000.20000000",
      askQty: "1.00000000",
    };
    expect(formatSnapshot(record)).toBe(
      "S,1,42,1767571200266000000,1767571200266700396,65000.10000000@1.00000000,65000.20000000@1.00000000",
    );
  });
});

describe("toSnapshotRecord", () => {
  it("carries the quote sample's bid/ask and timestamps through, using the placeholder qty on both sides", () => {
    const sample: QuoteSample = { bid: "100.00", ask: "100.05", exchangeTsNs: 10n, localTsNs: 15n, raw: {} };
    const record = toSnapshotRecord(sample, 7, 3, "0.50000000");
    expect(record).toEqual({
      instrument: 7,
      seq: 3,
      tsExchangeNs: 10n,
      tsLocalNs: 15n,
      bidPrice: "100.00",
      bidQty: "0.50000000",
      askPrice: "100.05",
      askQty: "0.50000000",
    });
  });
});

describe("RecordWriter", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes a comment header (skipped by record.rs's parser) then one S line per snapshot", () => {
    dir = mkdtempSync(path.join(tmpdir(), "recorder-writer-"));
    const file = path.join(dir, "out.csv");
    const writer = new RecordWriter(file, ["a header line", "another"]);
    writer.writeSnapshot({ instrument: 1, seq: 1, tsExchangeNs: 10n, tsLocalNs: 11n, bidPrice: "1.0", bidQty: "1", askPrice: "1.1", askQty: "1" });
    writer.writeSnapshot({ instrument: 1, seq: 2, tsExchangeNs: 20n, tsLocalNs: 21n, bidPrice: "1.0", bidQty: "1", askPrice: "1.1", askQty: "1" });
    writer.close();

    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines[0]).toBe("# a header line");
    expect(lines[1]).toBe("# another");
    expect(lines[2]).toBe("S,1,1,10,11,1.0@1,1.1@1");
    expect(lines[3]).toBe("S,1,2,20,21,1.0@1,1.1@1");
    expect(writer.written).toHaveLength(2);
  });
});
