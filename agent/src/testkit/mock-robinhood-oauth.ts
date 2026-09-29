// Local mock of Robinhood's trading MCP behind the standard MCP authorization flow (for
// agent/src/broker/robinhood-oauth.ts). One 127.0.0.1 HTTP server plays both roles:
//   - the OAuth 2.1 authorization server: metadata, dynamic client registration, /authorize
//     (redirects straight back, as if the founder had signed in), /token with PKCE S256 checks
//     and single-use refresh tokens: presenting a spent one revokes every token that client
//     holds, as OAuth 2.1 reuse detection does, so a double refresh cuts the connection;
//   - the protected MCP resource: protected-resource metadata, and /mcp, which answers 401 with
//     a WWW-Authenticate challenge unless the bearer token is one it issued and has not expired.
// /mcp is the existing SYNTHETIC mock (mock-robinhood-mcp.ts) over the SDK's own server
// transport. Nothing here talks to a real Robinhood endpoint.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMockRobinhoodServer } from "./mock-robinhood-mcp.js";

export interface MockOAuthOptions {
  /** Lifetime of each issued access token. */
  accessTtlSec?: number;
  /** Whether the token endpoint issues refresh tokens. */
  issueRefreshTokens?: boolean;
  /** Delay before answering a refresh grant, to hold two concurrent refreshes in flight. */
  refreshDelayMs?: number;
  /** Test hook: rewrites the state /authorize echoes back, to simulate a forged redirect. */
  authorizeState?: (sent: string) => string;
}

export interface MockOAuthServer {
  mcpUrl: string;
  /** Every tools/call name the MCP side received. */
  toolCalls: string[];
  /** grant_type of every /token request. */
  tokenGrants: string[];
  /** Makes every access token issued so far invalid, as if it had expired server-side. */
  expireAccessTokens(): void;
  /** Makes every refresh token issued so far invalid (revoked). */
  revokeRefreshTokens(): void;
  close(): Promise<void>;
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockRobinhoodOAuth(opts: MockOAuthOptions = {}): Promise<MockOAuthServer> {
  const ttlMs = (opts.accessTtlSec ?? 3600) * 1000;
  const clients = new Map<string, { redirect_uris: string[] }>();
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string }>();
  const accessTokens = new Map<string, { expiry: number; clientId: string }>();
  const refreshTokens = new Map<string, string>(); // token -> client id
  const spentRefreshTokens = new Map<string, string>(); // token -> client id
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const toolCalls: string[] = [];
  const tokenGrants: string[] = [];
  let base = "";

  const json = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };

  function issueTokens(clientId: string): Record<string, unknown> {
    const access = randomBytes(16).toString("hex");
    accessTokens.set(access, { expiry: Date.now() + ttlMs, clientId });
    const body: Record<string, unknown> = { access_token: access, token_type: "Bearer", expires_in: ttlMs / 1000 };
    if (opts.issueRefreshTokens ?? true) {
      const refresh = randomBytes(16).toString("hex");
      refreshTokens.set(refresh, clientId);
      body.refresh_token = refresh;
    }
    return body;
  }

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const expiry = bearer ? accessTokens.get(bearer)?.expiry : undefined;
    if (expiry === undefined || expiry <= Date.now()) {
      res
        .writeHead(401, { "www-authenticate": `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
        .end();
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    let transport = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!transport) {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => void sessions.set(id, transport!),
      });
      await createMockRobinhoodServer({ onToolCall: (name) => toolCalls.push(name) }).connect(transport);
    }
    await transport.handleRequest(req, res);
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", base);
    switch (url.pathname) {
      case "/.well-known/oauth-protected-resource/mcp":
        return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
      case "/.well-known/oauth-authorization-server":
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      case "/register": {
        const meta = JSON.parse(await readBody(req)) as { redirect_uris?: string[] };
        const clientId = `SYNTHETIC-client-${randomBytes(4).toString("hex")}`;
        clients.set(clientId, { redirect_uris: meta.redirect_uris ?? [] });
        return json(res, 201, { ...meta, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) });
      }
      case "/authorize": {
        const q = url.searchParams;
        const clientId = q.get("client_id") ?? "";
        const redirectUri = q.get("redirect_uri") ?? "";
        if (!clients.get(clientId)?.redirect_uris.includes(redirectUri)) return json(res, 400, { error: "invalid_request" });
        if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
          return json(res, 400, { error: "invalid_request", error_description: "PKCE S256 required" });
        }
        const code = randomBytes(16).toString("hex");
        codes.set(code, { clientId, redirectUri, challenge: q.get("code_challenge")! });
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        const state = q.get("state") ?? "";
        back.searchParams.set("state", opts.authorizeState ? opts.authorizeState(state) : state);
        res.writeHead(302, { location: back.href }).end();
        return;
      }
      case "/token": {
        const form = new URLSearchParams(await readBody(req));
        const grant = form.get("grant_type") ?? "";
        tokenGrants.push(grant);
        const clientId = form.get("client_id") ?? "";
        if (grant === "authorization_code") {
          const entry = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          const ok =
            entry && entry.clientId === clientId && entry.redirectUri === form.get("redirect_uri") && s256(form.get("code_verifier") ?? "") === entry.challenge;
          return ok ? json(res, 200, issueTokens(clientId)) : json(res, 400, { error: "invalid_grant" });
        }
        if (grant === "refresh_token") {
          const refresh = form.get("refresh_token") ?? "";
          if (spentRefreshTokens.get(refresh) === clientId) {
            for (const [t, owner] of refreshTokens) if (owner === clientId) refreshTokens.delete(t);
            for (const [t, a] of accessTokens) if (a.clientId === clientId) accessTokens.delete(t);
            return json(res, 400, { error: "invalid_grant", error_description: "refresh token reused" });
          }
          if (refreshTokens.get(refresh) !== clientId) return json(res, 400, { error: "invalid_grant" });
          refreshTokens.delete(refresh);
          spentRefreshTokens.set(refresh, clientId);
          if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
          return json(res, 200, issueTokens(clientId));
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      case "/mcp":
        return handleMcp(req, res);
      default:
        res.writeHead(404).end();
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) json(res, 500, { error: "server_error", error_description: String(err) });
    });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    mcpUrl: `${base}/mcp`,
    toolCalls,
    tokenGrants,
    expireAccessTokens: () => accessTokens.clear(),
    revokeRefreshTokens: () => refreshTokens.clear(),
    close: async () => {
      await Promise.all([...sessions.values()].map((t) => t.close()));
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
