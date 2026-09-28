# agent/ — TypeScript agent service: makes the final trade decision through qc-bridge (ADR-0040)

## Owns / does not own
- Owns: the Claude Agent SDK harness (`src/`), `prompts/` (versioned), the decider that turns a `DecisionRequest` into a `Decision`, the append-only decision ledger writer, `src/broker/` (Robinhood Agentic MCP client — never registered as an agent tool; it only executes an intent `qc-bridge` already approved).
- Does not own: whether an intent is accepted (qc-risk, qc-bridge), order state (qc-oms), the classifier signal (qc-inference), limits and the kill switch (config/limits/, qc-risk) — the agent proposes, `qc-bridge` disposes.

## Commands
- `just agent-setup`, `just agent-test`, `just agent-sim` (fake mode against tests/replay/sample_day.csv; running it twice must give identical ledger sha256)
- `QC_AGENT_MODE=fake ...`: no network, no key, what CI runs. `QC_AGENT_MODE=live ...`: needs `ANTHROPIC_API_KEY` and `scripts/ci/ai_gate.py loop-agent-eval` to allow it.

## MUST
- Exactly two SDK tools are registered, both from one in-process `createSdkMcpServer()`/`tool()` wrapper over `qc-bridge`: `get_decision_request` and `submit_decision` (`no_trade` is a `Decision` value, not a separate tool). `tools: []`; `allowedTools` names only these two; `permissionMode: "dontAsk"`.
- A `PreToolUse` hook denies any tool name other than the two above — defense in depth in case a future tool is added without updating the allowlist; `canUseTool` alone is not enough.
- `submit_decision` only ever calls the bridge's `submit_order_intent` (buy/sell) or `no_trade`; it never talks to a venue or broker directly.
- Every prompt has a version string; every ledger entry records that version plus the model id.
- Every `DecisionRequest`, prompt version, model id, full SDK request/response (or `"fake"` marker), `Decision`, and `IntentResult` is appended to `out/agent/ledger.jsonl` (gitignored, append-only; root rule 6).
- Live mode needs `ANTHROPIC_API_KEY` (secret manager, never in git — root rule 2) and a true result from `scripts/ci/ai_gate.py loop-agent-eval`; fake mode needs neither.
- `src/broker/` executes only an order `qc-bridge` already approved (an approval token bound to the intent hash); it is never one of the two SDK tools above.

## NEVER
- Never register the Robinhood MCP server, or any tool beyond the two above, as an agent tool. Check: `grep -rn 'allowedTools' src` lists only `get_decision_request` and `submit_decision`.
- Never let the agent hold, read, or forward a broker credential; `src/broker/` gets its session from the caller, not from environment variables the agent process can read.
- Never edit or skip a ledger line; corrections are new entries.
- Never train `ml/`'s classifier on this agent's decisions or outputs as labels (ADR-0040; Anthropic Commercial Terms and Usage Policy bar training on Claude outputs).
- Never call this service from `engine/`, and never let `engine/` make a network or AI call itself (root rule 1); the only channel between them is `qc-bridge`'s stdin/stdout.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- schemas/decision/v1/*.schema.json (the handoff contract); engine/crates/risk/CLAUDE.md; engine/crates/oms/CLAUDE.md
- ADR-0040 (agent handoff): docs/adr/0040-agentic-decision.md
