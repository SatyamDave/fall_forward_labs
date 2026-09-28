// The agent can't reach the broker: proves no file under agent/src/decider/ imports anything
// from agent/src/broker/ (issue #35's "no path the agent's own tool list can reach", made a
// structural test rather than a claim -- same spirit as agent/CLAUDE.md's "the loop fetches
// next_decision_request itself; the model never pulls market data through a tool").
//
// agent/src/decider/ doesn't exist in this worktree (it's a different lane's, wave1/agent-core,
// building in parallel off the same origin/main commit) -- this scans whatever *.ts files exist
// under agent/src (excluding this directory itself and testkit/) for an import specifier that
// resolves into agent/src/broker/, so it starts exercising real enforcement the moment that
// lane's files land, without needing to be re-written then.
//
// agent/src/recorder/ (issue #46, wave2-spec lane D) is a deliberate, documented exception: it
// reads quotes through agent/src/broker/robinhood.ts + mcp-client.ts by design (through a
// read-only tool allowlist -- agent/src/recorder/allowlist.ts -- that a separate test,
// agent/tests/recorder/allowlist*.test.ts, proves never lets an order/cancel tool through). What
// this test actually guards against is the *decider* reaching the broker directly, bypassing
// qc-bridge's approval; a read-only market-data recorder is not that path, so it's excluded here
// rather than silently making this test fail on every future recorder change.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SRC = path.resolve(HERE, "..", "..", "src");

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

// Matches `from "x"`, `require("x")`, dynamic `import("x")`, side-effect `import "x"`,
// and `export ... from "x"`: any of them can pull the broker into a module.
const IMPORT_SPECIFIER = /(?:\bfrom|\brequire\(|\bimport\(|\bimport)\s*['"]([^'"]+)['"]/g;

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
  it("no file under src/decider (or anywhere outside src/broker/src/recorder) imports src/broker", () => {
    const files = walk(AGENT_SRC).filter(
      (f) => !f.includes(`${path.sep}src${path.sep}broker${path.sep}`) && !f.includes(`${path.sep}src${path.sep}recorder${path.sep}`),
    );
    const offenders = files.flatMap((f) => importsBroker(f).map((spec) => `${path.relative(AGENT_SRC, f)}: imports "${spec}"`));
    expect(offenders).toEqual([]);
  });

  it("nothing outside src/recorder imports src/recorder, so the recorder can't be a side door to the broker", () => {
    // The recorder is excluded above because it legitimately imports the broker's read-only
    // quote mapping. That exception is only safe if no other code (decider, loop, bridge client)
    // can reach the broker through the recorder.
    const files = walk(AGENT_SRC).filter((f) => !f.includes(`${path.sep}src${path.sep}recorder${path.sep}`));
    const offenders = files.flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(IMPORT_SPECIFIER)]
        .map((m) => m[1]!)
        .filter((spec) => spec.startsWith("."))
        .filter((spec) => path.resolve(path.dirname(f), spec).includes(`${path.sep}src${path.sep}recorder`))
        .map((spec) => `${path.relative(AGENT_SRC, f)}: imports "${spec}"`);
    });
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
