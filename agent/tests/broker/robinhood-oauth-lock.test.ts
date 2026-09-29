// Refresh tokens are single-use, and the recorder and gateway refresh from separate processes.
// These tests run two real processes against the mock OAuth server, which revokes everything
// when a spent refresh token is presented, and check that only one of them refreshes.
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withFileLock } from "../../src/broker/file-lock.js";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { login, readStoredAuth } from "../../src/broker/robinhood-oauth.js";
import { repoRoot } from "../../src/paths.js";
import { startMockRobinhoodOAuth, type MockOAuthServer } from "../../src/testkit/mock-robinhood-oauth.js";

const agentDir = path.join(repoRoot(), "agent");
let dir: string;
let file: string;
let mock: MockOAuthServer | undefined;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "rh-oauth-lock-"));
  file = path.join(dir, "robinhood-oauth.json");
  process.env.QC_ROBINHOOD_TOKEN_PATH = file;
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

async function signedIn(): Promise<MockOAuthServer> {
  // Long enough that both children's refreshes overlap despite uneven process start-up.
  mock = await startMockRobinhoodOAuth({ refreshDelayMs: 1500 });
  process.env.ROBINHOOD_MCP_URL = mock.mcpUrl;
  await login({ serverUrl: mock.mcpUrl, file, openUrl: async (url) => void (await fetch(url)), timeoutMs: 5000 });
  return mock;
}

function expireStoredAccessToken(): void {
  writeFileSync(file, JSON.stringify({ ...readStoredAuth(file)!, expires_at_ms: 0 }), { mode: 0o600 });
}

function runChild(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      path.join(agentDir, "node_modules", ".bin", "tsx"),
      ["tests/helpers/oauthRefreshChild.ts"],
      { cwd: agentDir, env: process.env, timeout: 30_000 },
      (_err, stdout, stderr) => resolve({ code: child.exitCode, stdout, stderr }),
    );
  });
}

async function listTools(): Promise<number> {
  const client = await connectRobinhoodMcp();
  try {
    return (await client.listTools()).tools.length;
  } finally {
    await client.close();
  }
}

const refreshes = (m: MockOAuthServer) => m.tokenGrants.filter((g) => g === "refresh_token").length;

function deadPid(): number {
  const done = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(done.stdout);
}

describe("two processes refreshing the same sign-in", () => {
  it.each([
    ["the stored access token has expired (refresh up front)", () => expireStoredAccessToken()],
    ["the server rejects a token the file still thinks is valid (refresh on 401)", () => undefined],
  ])("only one refreshes when %s, and both end up signed in", async (_name, prepare) => {
    const m = await signedIn();
    prepare();
    m.expireAccessTokens();

    const [a, b] = await Promise.all([runChild(), runChild()]);

    expect([a.code, a.stderr], "first child").toEqual([0, ""]);
    expect([b.code, b.stderr], "second child").toEqual([0, ""]);
    expect(JSON.parse(a.stdout).tools).toBeGreaterThan(0);
    expect(JSON.parse(b.stdout).tools).toBeGreaterThan(0);
    expect(refreshes(m)).toBe(1);
    // The token both children left in the file still works, with no further refresh.
    expect(await listTools()).toBeGreaterThan(0);
    expect(refreshes(m)).toBe(1);
    expect(existsSync(`${file}.lock`)).toBe(false);
  }, 60_000);

  it("breaks a lock left by a process that died holding it, then refreshes once", async () => {
    const m = await signedIn();
    expireStoredAccessToken();
    m.expireAccessTokens();
    writeFileSync(`${file}.lock`, `${deadPid()} abandoned\n`);

    expect(await listTools()).toBeGreaterThan(0);
    expect(refreshes(m)).toBe(1);
    expect(existsSync(`${file}.lock`)).toBe(false);
  }, 30_000);
});

describe("withFileLock", () => {
  it("fails closed after the bounded wait while a live process holds the lock, leaving it alone", async () => {
    const lock = path.join(dir, "x.lock");
    const held = `${process.pid} other-holder\n`;
    writeFileSync(lock, held);
    let ran = false;
    const started = Date.now();
    await expect(withFileLock(lock, async () => void (ran = true), { waitMs: 300 })).rejects.toThrow(/timed out after 300ms/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ran).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(held);
  });

  it("breaks a lock whose holder pid is dead", async () => {
    const lock = path.join(dir, "x.lock");
    writeFileSync(lock, `${deadPid()} abandoned\n`);
    expect(await withFileLock(lock, async () => "ran", { waitMs: 300 })).toBe("ran");
    expect(existsSync(lock)).toBe(false);
  });

  it("breaks a lock older than the stale timeout even if its pid is alive (pid reuse)", async () => {
    const lock = path.join(dir, "x.lock");
    writeFileSync(lock, `${process.pid} reused\n`);
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect(await withFileLock(lock, async () => "ran", { waitMs: 300, staleMs: 60_000 })).toBe("ran");
  });

  it("serializes holders within one process too", async () => {
    const lock = path.join(dir, "x.lock");
    const order: string[] = [];
    const hold = (name: string) =>
      withFileLock(lock, async () => {
        order.push(`${name}+`);
        await new Promise((r) => setTimeout(r, 100));
        order.push(`${name}-`);
      });
    await Promise.all([hold("a"), hold("b")]);
    expect(order).toEqual(["a+", "a-", "b+", "b-"]);
  });
});
