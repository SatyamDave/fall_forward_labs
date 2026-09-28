#!/usr/bin/env node
// `just record-quotes [-- <flags>]`: polls Robinhood's order book for one instrument (full Level
// 2 depth when the asset class has one, top-of-book otherwise -- poll.ts's pollBook) and writes
// a replay-store CSV under data/raw/ plus a data/catalog/<dataset>.json manifest (issue #46,
// #43/#46 follow-up).
//
// --dry-run runs entirely in-process against agent/src/testkit/mock-robinhood-mcp.ts over an
// InMemoryTransport (no network, no real Robinhood connection -- hard limit). Without
// --dry-run it connects to ROBINHOOD_MCP_URL exactly like agent/src/broker/mcp-client.ts's
// connectRobinhoodMcp() always has.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import path from "node:path";
import { connectRobinhoodMcp } from "../broker/mcp-client.js";
import type { AssetClass } from "../broker/types.js";
import { repoRoot } from "../paths.js";
import { READ_ONLY_TOOLS, readOnly } from "./allowlist.js";
import { buildManifest, writeManifest } from "./catalog.js";
import { checkQuality } from "./quality.js";
import { RecordWriter } from "./record-writer.js";
import { runSession } from "./session.js";
import { createMockRobinhoodServer } from "../testkit/mock-robinhood-mcp.js";

interface Args {
  dryRun: boolean;
  instrumentId: number;
  symbol: string;
  assetClass: AssetClass;
  pollIntervalMs: number;
  requestBudget: number;
  placeholderQty: string;
  gapMultiple: number;
  maxLatencyMs: number;
  out?: string;
  catalogDir?: string;
  dataset?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dryRun: false,
    instrumentId: 1,
    symbol: "SPY",
    assetClass: "equity",
    pollIntervalMs: 1000,
    // Conservative default: Robinhood's Agentic MCP rate limit is UNVERIFIED (issue #27), so an
    // unattended full-day run must pass --request-budget explicitly (e.g. 23400 for one poll/sec
    // across a 6.5h regular session) rather than defaulting to something that large.
    requestBudget: 60,
    placeholderQty: "1.00000000",
    gapMultiple: 5,
    maxLatencyMs: 2000,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} requires a value`);
      return v;
    };
    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--instrument-id":
        args.instrumentId = Number(next());
        break;
      case "--symbol":
        args.symbol = next();
        break;
      case "--asset-class": {
        const v = next();
        if (v !== "equity" && v !== "crypto") throw new Error(`--asset-class must be equity or crypto, got ${v}`);
        args.assetClass = v;
        break;
      }
      case "--poll-interval-ms":
        args.pollIntervalMs = Number(next());
        break;
      case "--request-budget":
        args.requestBudget = Number(next());
        break;
      case "--placeholder-qty":
        args.placeholderQty = next();
        break;
      case "--gap-multiple":
        args.gapMultiple = Number(next());
        break;
      case "--max-latency-ms":
        args.maxLatencyMs = Number(next());
        break;
      case "--out":
        args.out = next();
        break;
      case "--catalog-dir":
        args.catalogDir = next();
        break;
      case "--dataset":
        args.dataset = next();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!Number.isFinite(args.instrumentId) || args.instrumentId < 0) throw new Error("--instrument-id must be a non-negative integer");
  if (!Number.isFinite(args.pollIntervalMs) || args.pollIntervalMs <= 0) throw new Error("--poll-interval-ms must be a positive number");
  if (!Number.isFinite(args.requestBudget) || args.requestBudget <= 0) throw new Error("--request-budget must be a positive number");
  return args;
}

function defaultDataset(symbol: string): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `recorder-${symbol.toLowerCase()}-${day}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataset = args.dataset ?? defaultDataset(args.symbol);
  const outPath = args.out ?? path.join(repoRoot(), "data", "raw", `${dataset}.csv`);
  const catalogDir = args.catalogDir ?? path.join(repoRoot(), "data", "catalog");

  const calledTools: string[] = [];
  let mockServer: Server | undefined;
  const rawClient = args.dryRun
    ? await (async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        mockServer = createMockRobinhoodServer({ onToolCall: (name) => calledTools.push(name) });
        await mockServer.connect(serverTransport);
        return connectRobinhoodMcp({ transport: clientTransport });
      })()
    : await connectRobinhoodMcp();
  const client = readOnly(rawClient);

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const writer = new RecordWriter(outPath, [
    `recorder output; instrument=${args.instrumentId} symbol=${args.symbol} asset_class=${args.assetClass}`,
    `generated_at=${new Date().toISOString()} mode=${args.dryRun ? "dry-run" : "live"}`,
    "format: engine/crates/gateway/src/record.rs (S,<instrument>,<seq>,<ts_exchange>,<ts_local>,<bids>,<asks>)",
  ]);

  let requestsMade = 0;
  let depthCounts = { l2: 0, top_of_book: 0 };
  try {
    const result = await runSession({
      client,
      assetClass: args.assetClass,
      symbol: args.symbol,
      instrumentId: args.instrumentId,
      pollIntervalMs: args.pollIntervalMs,
      requestBudget: args.requestBudget,
      placeholderQty: args.placeholderQty,
      writer,
      signal: controller.signal,
    });
    requestsMade = result.requestsMade;
    depthCounts = result.depthCounts;
  } finally {
    writer.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await rawClient.close();
    await mockServer?.close();
  }

  if (args.dryRun) {
    const illegal = calledTools.filter((t) => !READ_ONLY_TOOLS.has(t));
    if (illegal.length > 0) {
      throw new Error(`fatal: mock Robinhood server observed non-read-only tool call(s): ${illegal.join(", ")}`);
    }
  }

  const maxGapNs = BigInt(args.pollIntervalMs) * BigInt(args.gapMultiple) * 1_000_000n;
  const maxLatencyNs = BigInt(args.maxLatencyMs) * 1_000_000n;
  const quality = checkQuality(writer.written, maxGapNs, maxLatencyNs);

  const manifest = buildManifest({
    dataset,
    mode: args.dryRun ? "dry-run" : "live",
    instrumentId: args.instrumentId,
    symbol: args.symbol,
    assetClass: args.assetClass,
    pollIntervalMs: args.pollIntervalMs,
    requestBudget: args.requestBudget,
    requestsMade,
    depthCounts,
    records: writer.written,
    quality,
    recordingRelPath: path.relative(repoRoot(), outPath),
    recordingAbsPath: outPath,
  });
  const manifestPath = writeManifest(manifest, catalogDir);

  console.log(`wrote ${writer.written.length} record(s) to ${outPath}`);
  console.log(`catalog: ${manifestPath}`);
  console.log(`quality: ok=${quality.ok} seq_gaps=${quality.seqGaps.length} duplicates=${quality.duplicateSeqs.length} time_gaps=${quality.timeGaps.length} clock_skew=${quality.clockSkew.length}`);
  console.log(`depth: l2=${depthCounts.l2} top_of_book=${depthCounts.top_of_book}`);
  if (!quality.ok) {
    console.warn("quality checks found issues -- see the catalog manifest's \"quality\" field for details");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
