// robinhood-oauth.ts against a local mock OAuth authorization server fronting the existing mock
// Robinhood MCP, which requires a bearer token. The "browser" is a fetch of the authorize URL,
// which follows the mock's redirect to the login's loopback callback.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { login, readStoredAuth, tokenPath } from "../../src/broker/robinhood-oauth.js";
import { runSchemaCheck } from "../../src/broker/schema-check.js";
import { repoRoot } from "../../src/paths.js";
import { startMockRobinhoodOAuth, type MockOAuthOptions, type MockOAuthServer } from "../../src/testkit/mock-robinhood-oauth.js";

const browser = async (url: URL) => {
  await fetch(url);
};

let dir: string;
let file: string;
let mock: MockOAuthServer | undefined;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "rh-oauth-"));
  file = path.join(dir, "nested", "robinhood-oauth.json");
  process.env.QC_ROBINHOOD_TOKEN_PATH = file;
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

async function signedIn(opts: MockOAuthOptions = {}): Promise<MockOAuthServer> {
  mock = await startMockRobinhoodOAuth(opts);
  process.env.ROBINHOOD_MCP_URL = mock.mcpUrl;
  await login({ serverUrl: mock.mcpUrl, file, openUrl: browser, timeoutMs: 5000 });
  return mock;
}

function expireStoredAccessToken(): void {
  const stored = readStoredAuth(file)!;
  writeFileSync(file, JSON.stringify({ ...stored, expires_at_ms: 0 }), { mode: 0o600 });
}

async function listVia(client: Client): Promise<number> {
  try {
    return (await client.listTools()).tools.length;
  } finally {
    await client.close();
  }
}

describe("robinhood login", () => {
  it("runs the full authorization-code + PKCE flow, stores 0600 outside the repo, and only lists tools", async () => {
    mock = await startMockRobinhoodOAuth();
    const count = await login({ serverUrl: mock.mcpUrl, file, openUrl: browser, timeoutMs: 5000 });

    expect(count).toBeGreaterThan(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(path.relative(repoRoot(), file).startsWith("..")).toBe(true);
    const stored = readStoredAuth(file)!;
    expect(stored.server_url).toBe(mock.mcpUrl);
    expect(stored.tokens.refresh_token).toBeTruthy();
    expect(stored.expires_at_ms).toBeGreaterThan(Date.now());
    expect(mock.tokenGrants).toEqual(["authorization_code"]);
    expect(mock.toolCalls).toEqual([]);
  });

  it("rejects a callback whose state does not match and stores nothing", async () => {
    mock = await startMockRobinhoodOAuth({ authorizeState: () => "forged" });
    await expect(login({ serverUrl: mock.mcpUrl, file, openUrl: browser, timeoutMs: 5000 })).rejects.toThrow(/state did not match/);
    expect(existsSync(file)).toBe(false);
    expect(mock.tokenGrants).toEqual([]);
  });

  it("defaults the token file to ~/.config and refuses a path inside the repo", () => {
    delete process.env.QC_ROBINHOOD_TOKEN_PATH;
    expect(tokenPath()).toBe(path.join(os.homedir(), ".config", "fall_forward_labs", "robinhood-oauth.json"));
    process.env.QC_ROBINHOOD_TOKEN_PATH = path.join(repoRoot(), "out", "robinhood-oauth.json");
    expect(() => tokenPath()).toThrow(/inside the repository/);
  });
});

describe("stored sign-in (schema check, gateway, recorder)", () => {
  it("fails closed with a re-login message when there is no stored sign-in", async () => {
    mock = await startMockRobinhoodOAuth();
    process.env.ROBINHOOD_MCP_URL = mock.mcpUrl;
    await expect(connectRobinhoodMcp()).rejects.toThrow(/just robinhood-login/);
    // And the mock really does refuse a client that has no token at all.
    const bare = new Client({ name: "bare", version: "0" });
    await expect(bare.connect(new StreamableHTTPClientTransport(new URL(mock.mcpUrl)))).rejects.toThrow();
  });

  it("the schema check lists tools with the stored token and never calls a tool", async () => {
    const m = await signedIn();
    const result = await runSchemaCheck(await connectRobinhoodMcp(), "real", path.join(dir, "out"));
    expect(result.problems).toEqual([]);
    expect(result.toolCount).toBeGreaterThan(0);
    expect(m.toolCalls).toEqual([]);
  });

  it("refreshes an expired access token before connecting, and rewrites the file 0600", async () => {
    const m = await signedIn();
    const before = readStoredAuth(file)!.tokens.access_token;
    expireStoredAccessToken();
    chmodSync(file, 0o644);
    m.expireAccessTokens();

    expect(await listVia(await connectRobinhoodMcp())).toBeGreaterThan(0);
    expect(m.tokenGrants).toEqual(["authorization_code", "refresh_token"]);
    expect(readStoredAuth(file)!.tokens.access_token).not.toBe(before);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refreshes when the server rejects a token the file still thinks is valid", async () => {
    const m = await signedIn();
    m.expireAccessTokens();
    expect(await listVia(await connectRobinhoodMcp())).toBeGreaterThan(0);
    expect(m.tokenGrants).toEqual(["authorization_code", "refresh_token"]);
  });

  it("fails closed when the access token expired and there is no refresh token", async () => {
    const m = await signedIn({ issueRefreshTokens: false });
    expireStoredAccessToken();
    await expect(connectRobinhoodMcp()).rejects.toThrow(/no refresh token.*just robinhood-login/);
    expect(m.tokenGrants).toEqual(["authorization_code"]);
  });

  it("fails closed when the refresh token is rejected", async () => {
    const m = await signedIn();
    expireStoredAccessToken();
    m.expireAccessTokens();
    m.revokeRefreshTokens();
    await expect(connectRobinhoodMcp()).rejects.toThrow(/just robinhood-login/);
  });

  it("fails closed when the server rejects the token and it cannot be refreshed", async () => {
    const m = await signedIn();
    m.expireAccessTokens();
    m.revokeRefreshTokens();
    await expect(connectRobinhoodMcp()).rejects.toThrow(/just robinhood-login/);
  });

  it("refuses a stored sign-in made for a different server URL", async () => {
    await signedIn();
    process.env.ROBINHOOD_MCP_URL = "http://127.0.0.1:1/mcp";
    await expect(connectRobinhoodMcp()).rejects.toThrow(/different server URL/);
  });

  it("`schema-check --target real` exits 1 and says to run robinhood-login when not signed in", async () => {
    mock = await startMockRobinhoodOAuth();
    const agentDir = path.join(repoRoot(), "agent");
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = execFile(
        path.join(agentDir, "node_modules", ".bin", "tsx"),
        ["src/broker/schema-check-cli.ts", "--target", "real"],
        { cwd: agentDir, env: { ...process.env, ROBINHOOD_MCP_URL: mock!.mcpUrl }, timeout: 30_000 },
        (_err, _stdout, stderr) => resolve({ code: child.exitCode, stderr }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/just robinhood-login/);
    expect(mock.toolCalls).toEqual([]);
  }, 30_000);
});
