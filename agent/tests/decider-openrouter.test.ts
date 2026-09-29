// OpenRouter decider against a local mock HTTP server: no real network call, no real key.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type OpenRouterConfig, OpenRouterDecider, resolveOpenRouterConfig } from "../src/decider/openrouter.js";
import type { DecisionRequest } from "../src/types.js";

const FAKE_KEY = "sk-or-v1-test-not-a-real-key-0123456789";
const FAKE_ACCOUNT_NUMBER = "5QR98765432";

function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    request_id: "req-1",
    ts_ns: 1,
    instrument: "SIM-BTC",
    best_bid: "100.0",
    best_ask: "100.1",
    mid: "100.05",
    spread_ticks: 1,
    features: {},
    signal: { direction: "up", probs: [0.1, 0.2, 0.7], model_sha256: "a".repeat(64) },
    position: "0",
    limits: { max_position: "10", max_notional: "100000", max_order_rate_per_sec: 5, remaining_daily_loss: "1000" },
    allowed_actions: ["buy", "sell", "no_trade"],
    ...overrides,
  };
}

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler;
const seen: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/chat/completions`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function reply(content: string, cost: number | null = 0, status = 200): Handler {
  return (_req, _body, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    const usage = cost === null ? {} : { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost } };
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], ...usage }));
  };
}

function config(overrides: Partial<OpenRouterConfig> = {}): OpenRouterConfig {
  return { apiKey: FAKE_KEY, model: "test/model:free", timeoutMs: 2000, maxUsdPerDay: 0n, ...overrides };
}

function decider(overrides: Partial<OpenRouterConfig> = {}): OpenRouterDecider {
  return new OpenRouterDecider({ endpoint, config: config(overrides), env: {} });
}

const BUY = { request_id: "req-1", action: "buy", qty: "1", limit_price: "100.1", confidence: 0.7, rationale: "up signal" };

describe("OpenRouterDecider.decide", () => {
  it("passes a valid buy decision through, cost recorded as 0 only because OpenRouter said 0", async () => {
    handler = reply(JSON.stringify(BUY), 0);
    const out = await decider().decide(request());
    expect(out.decision).toEqual(BUY);
    expect(out.costUsd).toBe("0");
  });

  it("sends a JSON-only request with no tools", async () => {
    handler = reply(JSON.stringify(BUY));
    await decider().decide(request());
    const body = JSON.parse(seen.at(-1)!.body);
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("test/model:free");
  });

  it("request body carries no env var value, no key and no account number", async () => {
    const env = { ...process.env, OPENROUTER_API_KEY: FAKE_KEY, QC_ROBINHOOD_ACCOUNT_NUMBER: FAKE_ACCOUNT_NUMBER };
    handler = reply(JSON.stringify(BUY));
    await new OpenRouterDecider({ endpoint, config: config(), env }).decide(request());
    const { headers, body } = seen.at(-1)!;
    expect(headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(body).not.toContain(FAKE_KEY);
    expect(body).not.toContain(FAKE_ACCOUNT_NUMBER);
    // Short values ("1", "true") appear in any JSON by chance; the model id is sent on purpose.
    const leaked = Object.entries(env).filter(
      ([k, v]) => k !== "QC_OPENROUTER_MODEL" && v !== undefined && v.length >= 8 && body.includes(v),
    );
    expect(leaked).toEqual([]);
  });

  it("records the reported cost and throws once it passes the daily cap", async () => {
    handler = reply(JSON.stringify(BUY), 0.004);
    const d = decider({ maxUsdPerDay: 500_000n }); // 0.005 USD
    expect((await d.decide(request())).costUsd).toBe("0.004");
    await expect(d.decide(request())).rejects.toThrow(/over the 0.005 USD cap/);
  });

  it("any positive cost stops a run at the default cap of 0", async () => {
    handler = reply(JSON.stringify(BUY), 0.0000000001);
    await expect(decider().decide(request())).rejects.toThrow(/over the 0 USD cap/);
  });

  it("unknown cost is recorded as unknown in raw for a :free model", async () => {
    handler = reply(JSON.stringify(BUY), null);
    const out = await decider().decide(request());
    expect(out.costUsd).toBeUndefined();
    expect((out.raw as Record<string, unknown>).cost_usd).toBe("unknown");
  });

  it("unknown cost on a non-free model refuses to continue", async () => {
    handler = reply(JSON.stringify(BUY), null);
    await expect(decider({ model: "test/paid", maxUsdPerDay: 100n }).decide(request())).rejects.toThrow(/no usable cost/);
  });

  const noTradeCases: Array<[string, Handler, Partial<DecisionRequest>, RegExp]> = [
    ["malformed JSON", reply("{not json"), {}, /non-JSON/],
    ["429 rate limit", reply("{}", 0, 429), {}, /HTTP 429 \(rate limited\)/],
    ["HTTP 500", reply("{}", 0, 500), {}, /HTTP 500/],
    ["schema-invalid (float qty)", reply(JSON.stringify({ ...BUY, qty: 1 })), {}, /schema-invalid/],
    ["buy missing limit_price", reply(JSON.stringify({ ...BUY, limit_price: undefined })), {}, /schema-invalid/],
    ["action not allowed", reply(JSON.stringify(BUY)), { allowed_actions: ["sell", "no_trade"] }, /buy is not in allowed_actions/],
    ["qty over max_position", reply(JSON.stringify({ ...BUY, qty: "11" })), {}, /exceeds max_position/],
    ["buy on top of an existing position", reply(JSON.stringify(BUY)), { position: "10" }, /exceeds max_position/],
    ["notional over max_notional", reply(JSON.stringify(BUY)), { limits: { max_position: "10", max_notional: "50", max_order_rate_per_sec: 5, remaining_daily_loss: "1" } }, /max_notional/],
    ["zero qty", reply(JSON.stringify({ ...BUY, qty: "0" })), {}, /qty must be positive/],
    ["wrong request_id", reply(JSON.stringify({ ...BUY, request_id: "req-2" })), {}, /does not match/],
  ];
  for (const [name, h, reqOverrides, reason] of noTradeCases) {
    it(`${name} becomes no_trade with the reason in raw`, async () => {
      handler = h;
      const out = await decider().decide(request(reqOverrides));
      expect(out.decision.action).toBe("no_trade");
      expect(out.decision.request_id).toBe("req-1");
      expect((out.raw as Record<string, unknown>).no_trade_reason).toMatch(reason);
    });
  }

  it("timeout becomes no_trade", async () => {
    handler = () => {}; // never answers
    const out = await decider({ timeoutMs: 100 }).decide(request());
    expect(out.decision.action).toBe("no_trade");
    expect((out.raw as Record<string, unknown>).no_trade_reason).toMatch(/TimeoutError/);
  });

  it("accepts a fenced JSON reply, still schema-checked", async () => {
    handler = reply("```json\n" + JSON.stringify(BUY) + "\n```");
    expect((await decider().decide(request())).decision).toEqual(BUY);
  });
});

describe("resolveOpenRouterConfig refuses to start", () => {
  const base = { OPENROUTER_API_KEY: FAKE_KEY, QC_OPENROUTER_MODEL: "test/model:free" };
  it("without OPENROUTER_API_KEY", () => {
    expect(() => resolveOpenRouterConfig({ QC_OPENROUTER_MODEL: "x:free" })).toThrow(/OPENROUTER_API_KEY is not set/);
  });
  it("without QC_OPENROUTER_MODEL", () => {
    expect(() => resolveOpenRouterConfig({ OPENROUTER_API_KEY: FAKE_KEY })).toThrow(/QC_OPENROUTER_MODEL is not set/);
  });
  it("with a bad timeout", () => {
    expect(() => resolveOpenRouterConfig({ ...base, QC_OPENROUTER_TIMEOUT_MS: "soon" })).toThrow(/positive integer/);
  });
  it("with a paid model and the default zero spend cap", () => {
    expect(() => resolveOpenRouterConfig({ ...base, QC_OPENROUTER_MODEL: "test/paid" })).toThrow(/not a ":free" model/);
  });
  it("while ai_gate.py denies loop-agent-openrouter (POLICY.yaml default: disabled)", () => {
    expect(() => resolveOpenRouterConfig({ ...process.env, ...base, AUTONOMY_ENABLED: "true" })).toThrow(
      /ai_gate\.py denied loop-agent-openrouter/,
    );
  });
});
