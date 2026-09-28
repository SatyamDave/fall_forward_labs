// Agent SDK decider (QC_AGENT_MODE=live). The model's only path to a decision is one of two
// in-process wrapper tools; every other tool is unavailable (`tools: []`, only this one MCP
// server registered) and, as a final code-level gate independent of that config, a PreToolUse
// hook denies any tool_name that isn't exactly one of the two. The model never sees Robinhood's
// MCP server, a broker credential, or a real submit path — this decider only produces a
// Decision; src/loop.ts is what calls the real qc-bridge afterwards.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSdkMcpServer,
  type HookCallback,
  type Options,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { repoRoot } from "../paths.js";
import { loadRawSchema } from "../schema.js";
import type { Decision, DecisionRequest } from "../types.js";
import type { Decider, DecisionOutcome } from "./types.js";

export const PROMPT_VERSION = "v1";
export const SDK_SERVER_NAME = "decision";
export const SUBMIT_ORDER_INTENT_TOOL = `mcp__${SDK_SERVER_NAME}__submit_order_intent`;
export const NO_TRADE_TOOL = `mcp__${SDK_SERVER_NAME}__no_trade`;
export const ALLOWED_LIVE_TOOLS = [SUBMIT_ORDER_INTENT_TOOL, NO_TRADE_TOOL] as const;

const DECIMAL_STRING = /^-?[0-9]+(\.[0-9]{1,8})?$/;

const submitOrderIntentShape = {
  request_id: z.string(),
  action: z.enum(["buy", "sell"]),
  qty: z.string().regex(DECIMAL_STRING),
  limit_price: z.string().regex(DECIMAL_STRING),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(500),
};

const noTradeShape = {
  request_id: z.string(),
  rationale: z.string().max(500),
};

/**
 * Authoritative gate: fires on every tool call (no matcher) and denies anything whose name
 * isn't exactly one of the two wrapper tools, independent of `allowedTools`/`permissionMode`.
 * A permission rule that never runs is not a permission that held — this hook always runs.
 */
export const preToolUseHook: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  const allowed = (ALLOWED_LIVE_TOOLS as readonly string[]).includes(input.tool_name);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: allowed ? "allow" : "deny",
      permissionDecisionReason: allowed
        ? "wrapper decision tool"
        : `denied: only ${ALLOWED_LIVE_TOOLS.join(", ")} may run in the live decider`,
    },
  };
};

function promptPath(): string {
  return path.join(repoRoot(), "agent", "src", "prompts", `decide-${PROMPT_VERSION}.md`);
}

export function buildPrompt(req: DecisionRequest): string {
  const template = readFileSync(promptPath(), "utf8");
  return `${template}\n\n## Decision request\n\n\`\`\`json\n${JSON.stringify(req, null, 2)}\n\`\`\`\n`;
}

export interface LivePolicy {
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMinutes: number;
  model?: string;
}

/**
 * Fail closed: live mode may run only with an API key present AND `ai_gate.py loop-agent-eval`
 * allowing it (autonomy/POLICY.yaml, disabled with a zero budget until a human sets real
 * numbers). Reuses ai_gate.py's own GITHUB_OUTPUT contract for the budget numbers rather than
 * re-parsing POLICY.yaml's YAML-with-comments format in TypeScript — one parser, one place.
 */
export function resolveLivePolicy(env: NodeJS.ProcessEnv = process.env): LivePolicy {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("live mode refused: ANTHROPIC_API_KEY is not set");
  }
  const outDir = mkdtempSync(path.join(tmpdir(), "ai-gate-"));
  const outFile = path.join(outDir, "output");
  const result = spawnSync("python3", ["scripts/ci/ai_gate.py", "loop-agent-eval"], {
    cwd: repoRoot(),
    env: { ...env, GITHUB_OUTPUT: outFile },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const reason = (result.stdout ?? result.stderr ?? "").trim();
    throw new Error(`live mode refused: ai_gate.py denied loop-agent-eval: ${reason}`);
  }
  const output = Object.fromEntries(
    readFileSync(outFile, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
  const maxTurns = Number(output.max_turns);
  const maxBudgetUsd = Number(output.max_budget_usd);
  const timeoutMinutes = Number(output.timeout_minutes);
  if (!Number.isFinite(maxTurns) || !Number.isFinite(maxBudgetUsd) || !Number.isFinite(timeoutMinutes)) {
    throw new Error(`live mode refused: ai_gate.py allowed but gave no usable budget (${JSON.stringify(output)})`);
  }
  return { maxTurns, maxBudgetUsd, timeoutMinutes };
}

export function buildOptions(policy: LivePolicy, capture: { outcome?: Decision }): Options {
  const submitOrderIntent = tool(
    "submit_order_intent",
    "Submit the final buy/sell decision for this request. The engine independently re-checks " +
      "risk; this call only records the proposed decision, it does not place an order.",
    submitOrderIntentShape,
    async (args) => {
      capture.outcome = {
        request_id: args.request_id,
        action: args.action,
        qty: args.qty,
        limit_price: args.limit_price,
        confidence: args.confidence,
        rationale: args.rationale,
      };
      return { content: [{ type: "text", text: "recorded" }] };
    },
  );
  const noTrade = tool("no_trade", "Decline to trade this request.", noTradeShape, async (args) => {
    capture.outcome = { request_id: args.request_id, action: "no_trade", rationale: args.rationale };
    return { content: [{ type: "text", text: "recorded" }] };
  });
  const server = createSdkMcpServer({
    name: SDK_SERVER_NAME,
    version: "1.0.0",
    tools: [submitOrderIntent, noTrade],
  });

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), policy.timeoutMinutes * 60_000);
  timer.unref?.();

  return {
    tools: [],
    mcpServers: { [SDK_SERVER_NAME]: server },
    allowedTools: [...ALLOWED_LIVE_TOOLS],
    permissionMode: "dontAsk",
    hooks: { PreToolUse: [{ hooks: [preToolUseHook] }] },
    maxTurns: policy.maxTurns,
    maxBudgetUsd: policy.maxBudgetUsd,
    outputFormat: { type: "json_schema", schema: loadRawSchema("decision") },
    abortController,
    model: policy.model,
    persistSession: false,
  };
}

export class LiveDecider implements Decider {
  async decide(req: DecisionRequest): Promise<DecisionOutcome> {
    const policy = resolveLivePolicy();
    const capture: { outcome?: Decision } = {};
    const options = buildOptions(policy, capture);
    const prompt = buildPrompt(req);

    const raw: unknown[] = [];
    let costUsd: number | undefined;
    let structuredOutput: Decision | undefined;
    for await (const message of query({ prompt, options })) {
      raw.push(message);
      if (message.type === "result" && message.subtype === "success") {
        costUsd = message.total_cost_usd;
        if (message.structured_output) structuredOutput = message.structured_output as Decision;
      }
    }

    const decision = capture.outcome ?? structuredOutput;
    if (!decision) {
      throw new Error(`live decider produced no decision for request ${req.request_id}`);
    }
    return { decision, raw, costUsd };
  }
}
