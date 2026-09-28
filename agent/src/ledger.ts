// Append-only decision ledger: out/agent/ledger.jsonl (gitignored). Every entry is validated
// against decision_ledger_entry before it's written; a bad entry throws instead of corrupting
// the file. Never truncates or rewrites — only appendFileSync.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ledgerPath as defaultLedgerPath } from "./paths.js";
import { validateOrThrow } from "./schema.js";
import type { DecisionLedgerEntry } from "./types.js";

export function appendLedgerEntry(entry: DecisionLedgerEntry, filePath: string = defaultLedgerPath()): void {
  validateOrThrow("decision_ledger_entry", entry);
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function ledgerSha256(filePath: string = defaultLedgerPath()): string {
  const contents = existsSync(filePath) ? readFileSync(filePath) : Buffer.alloc(0);
  return createHash("sha256").update(contents).digest("hex");
}
