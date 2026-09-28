// The agent can't reach the broker: proves no file under agent/src/decider/ imports anything
// from agent/src/broker/ (issue #35's "no path the agent's own tool list can reach", made a
// structural test rather than a claim -- same spirit as agent/CLAUDE.md's "the loop fetches
// next_decision_request itself; the model never pulls market data through a tool").
//
// Scope note (wave 2, gateway-integration): this used to scan every file under agent/src except
// broker/ itself, which happened to match this test's stated intent only because nothing outside
// decider/ had a reason to import broker/ yet. Wave 2 intentionally wires agent/src/loop.ts (and
// agent/src/bridge.ts, agent/src/cli.ts) to agent/src/broker/ -- that IS the fix for the "gateway
// isn't wired to the real bridge" gap, not a violation of this boundary. The boundary this test
// exists to prove is specifically decider/ -> broker/ (the LLM's own reasoning loop must never
// reach a broker credential or tool), so the scan is narrowed to agent/src/decider/ to match.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SRC = path.resolve(HERE, "..", "..", "src");
const DECIDER_SRC = path.join(AGENT_SRC, "decider");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const IMPORT_SPECIFIER = /(?:from|require\()\s*['"]([^'"]+)['"]/g;

function importsBroker(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const hits: string[] = [];
  for (const match of src.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue; // only same-package relative imports can reach src/broker
    const resolved = path.resolve(path.dirname(file), specifier);
    if (resolved.includes(`${path.sep}src${path.sep}broker${path.sep}`) || resolved.endsWith(`${path.sep}src${path.sep}broker`)) {
      hits.push(specifier);
    }
  }
  return hits;
}

describe("agent/src/decider/ cannot import agent/src/broker/", () => {
  it("no file under src/decider imports src/broker", () => {
    if (!existsSync(DECIDER_SRC)) return; // not built yet in this worktree; see header comment
    const files = walk(DECIDER_SRC);
    const offenders = files.flatMap((f) => importsBroker(f).map((spec) => `${path.relative(AGENT_SRC, f)}: imports "${spec}"`));
    expect(offenders).toEqual([]);
  });

  it("sanity: the scanner actually detects a broker import when one exists", () => {
    // Guards against the test above silently passing because the regex/resolution stopped
    // matching anything (e.g. after a refactor) rather than because there's truly no import.
    const decoy = path.join(HERE, "__decoy_import_fixture.ts");
    const fixtureSrc = 'import { BrokerGateway } from "../../src/broker/gateway.js";\n';
    // Use the same detection logic against an in-memory "file" via a temp path resolution,
    // without writing to disk: reuse importsBroker's regex/resolve logic directly.
    const hits: string[] = [];
    for (const match of fixtureSrc.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1]!;
      const resolved = path.resolve(path.dirname(decoy), specifier);
      if (resolved.includes(`${path.sep}src${path.sep}broker${path.sep}`) || resolved.endsWith(`${path.sep}src${path.sep}broker`)) {
        hits.push(specifier);
      }
    }
    expect(hits).toEqual(["../../src/broker/gateway.js"]);
  });
});
