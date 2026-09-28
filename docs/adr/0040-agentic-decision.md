# ADR-0040: Agentic trading decision (final trade call moves to an AI agent)

## Status

Accepted by Satyam 2026-09-28. Pending Rohit's approval per the decision protocol in
[docs/TEAM.md](../TEAM.md#review-and-the-enforcement-gap) (protected-zone and non-negotiable-rule
changes need both founders; Rohit has not yet reviewed this ADR). Root [CLAUDE.md](../../CLAUDE.md)
rule 1 is amended by this decision for the trade-decision step only; see "Rule 1 amendment" below.
Until Rohit approves, this ADR authorizes the offline, fake-mode, no-network build work in the
`agentic/*` lanes (schemas, `qc-bridge`, the agent service skeleton, evals scaffolding, CI/policy
entries) and nothing that calls a live model, calls Robinhood, or spends real money.

## Context

The owner (Satyam) asked to move the final trade decision from a purely deterministic rule to an
AI agent: the Rust engine keeps producing a calibrated signal, but an agent built with the
`@anthropic-ai/claude-agent-sdk` now makes the trade / no-trade / side / size call, and places
orders only through our own risk-wrapped tool, which then talks to a venue (SimVenue today,
Robinhood's Agentic Trading MCP server later). This directly changes root rule 1 ("no agent or LLM
call in the live trading path"), which [ADR-0010](0010-decision-layer.md) had already used to keep
every hosted decision model (TypeSafe's Jev, and by the same logic any LLM) out of the trading path
and confined to the control plane. That reasoning does not disappear — latency, determinism and
leakage are all still real constraints, cited below with sources — but the owner's decision is to
accept those costs for the trade-decision step specifically, with a deterministic risk engine and
kill switch as the check that still runs regardless of what the agent proposes.

Four research files were produced to ground this decision in primary sources rather than
assumption, all accessed 2026-09-27 unless noted: `robinhood-research.md` (official Robinhood APIs
by asset class and the customer-agreement automation clauses), `robinhood-agentic-mcp.md`
(Agentic Trading's tool surface, account model and terms, extending the first file),
`agent-sdk-research.md` (the Claude Agent SDK's tool-isolation mechanics, latency and
usage-policy/commercial-terms clauses), and `llm-trading-eval-research.md` (the academic literature
on backtesting LLM trading agents, multi-agent design, and calibration). Every citation below is
copied from those files; items neither file could verify from a primary source are marked
**UNVERIFIED**, and legal-judgment questions are marked **requires counsel**, matching the research
files' own convention.

### Why now, and why this shape

- The offline lab, the Rust engine's deterministic risk checks, kill switch, OMS and replay
  determinism (root rules 4, 7, 11) are unchanged and stay unchanged: nothing in this ADR touches
  `engine/crates/risk/**` or loosens a limit (root rule 4; a change there needs two human approvals
  under root rule 3, independent of this ADR).
- SimVenue and a Robinhood adapter do not exist yet (`docs/ROADMAP.md` M1, ADR-0003/ADR-0020, still
  Proposed/pending the first-vertical decision). This ADR does not itself pick the first vertical;
  it picks the shape of the decision-making pipeline that will sit in front of whichever venue
  adapter M1 builds.
- The four research files exist because the owner's original framing used terms ("HFAT",
  "backtest the agent", "every PR runs an eval", "parallel agents") that the evidence does not
  support as stated. Those gaps are the "Challenges to the owner's plan" section below, not buried
  in the Decision.

## Decision

### 1. The pipeline

```
lab (offline, unchanged) → Rust engine (order book, features, qc-inference classifier,
unchanged core) → qc-bridge (NEW, Rust, exposes the engine's decisions over a bridge protocol)
→ agent service (NEW, TypeScript, Claude Agent SDK, in-process wrapper tool only)
→ submit_order_intent (the agent's only callable action)
→ risk (qc-risk + kill switch, unchanged, runs regardless of who called submit_order_intent)
→ OMS (unchanged) → gateway → SimVenue (v1, tests/paper) | Robinhood Agentic MCP (planned, live)
```

The engine's classifier (`qc-inference`) keeps producing a calibrated signal (direction, class
probabilities, model hash) exactly as ADR-0010 point 3 describes; that model is still trained and
gated entirely offline and still makes no network call. What is new is what happens to that signal:
instead of a fixed rule consuming it directly, the engine assembles a `DecisionRequest` and hands it
to `qc-bridge`, which exposes it to the agent service. The agent's decision comes back as a proposed
`Decision`, submitted as an `order_intent` through `submit_order_intent` — the only tool the agent
process can call — and from there the existing deterministic risk engine, kill switch and OMS run
exactly as they do for any other order source (this is the load-bearing invariant: **risk is
authoritative, not advisory**; a check that could not run is not a check that passed).

### 2. Handoff protocol v1

Transport: the TypeScript agent service spawns the Rust `qc-bridge` binary (new crate
`engine/crates/bridge`) and exchanges JSON Lines over its stdin/stdout — one JSON object per line,
UTF-8. Every message carries `"v":1` and a caller-chosen `"id"` that is echoed back. Money and
quantity fields are decimal strings (the Rust side keeps its existing fixed-point representation),
never JSON floats; timestamps are integer nanoseconds (`ts_ns`).

Schemas live at `schemas/decision/v1/*.schema.json` (JSON Schema 2020-12): `decision_request`,
`decision`, `order_intent`, `intent_result`, `bridge_request`, `bridge_response`,
`decision_ledger_entry`. Both the Rust and TypeScript sides test against the same schema files, so
a schema change is a single-source-of-truth change, not two definitions that can drift.

Operations (TS → bridge): `next_decision_request` (returns the next `DecisionRequest`, or `null`
when the recording/feed is exhausted), `submit_order_intent` (runs the existing `RiskEngine` + kill
switch + OMS, routes to SimVenue — the only venue in v1 — and returns `{accepted, client_order_id?,
risk_reject?, halted?}`), `no_trade` (recorded in the decision log, no order), `status` (position,
open orders, halted state, remaining limits), `shutdown`. An unknown op, a bad version, or a schema
violation returns a typed error, never a guessed default — this is the same "fail closed on
anything unclear" posture root rule 12 already asks for.

`DecisionRequest` carries: `request_id`, `ts_ns`, `instrument`, `best_bid`/`best_ask`/`mid`/
`spread_ticks`, `features` (the existing `tob-v1` map), `signal` (`{direction, probs, model_sha256}`
or `null` for no signal), `position`, `limits` (`max_position`, `max_notional`,
`max_order_rate_per_sec`, `remaining_daily_loss`), and `allowed_actions` (a subset of
`["buy","sell","no_trade"]` — the engine, not the agent, decides what is even offerable).

`Decision` (the agent's output, forced through the SDK's `outputFormat: {type:"json_schema"}` so it
is schema-validated rather than parsed from free text): `request_id`, `action`, `qty`,
`limit_price`, `confidence` (0-1, **advisory only** — see the calibration finding in Challenges),
`rationale` (≤ 500 chars).

### 3. Isolation pattern: the agent never sees a broker tool

This is the strongest guarantee the research turned up, and it is architectural rather than a
permission setting (`agent-sdk-research.md` §3, quoting the SDK's own docs): **Robinhood's MCP
server is never entered into the agent service's `options.mcpServers`.** The agent's `query()` call
registers exactly one in-process `createSdkMcpServer()` tool (`submit_order_intent`), with
`tools: []` (every Claude Code built-in — notably `Bash`/`WebFetch`, which could otherwise reach an
arbitrary URL — stripped from the model's context), `allowedTools` naming only that one tool,
`permissionMode: "dontAsk"` (an unmatched call is denied outright, `canUseTool` is never invoked),
and a `PreToolUse` hook matching `"^mcp__(?!execution__submit_order_intent$)"` as a final,
code-level deny that runs before any allow/deny-list evaluation — the research is explicit that
`canUseTool` alone is insufficient (it is bypassed by an auto-approving rule or
`bypassPermissions` mode) and the hook is the authoritative gate.

The broker gateway itself — the actual MCP client that would talk to
`https://agent.robinhood.com/mcp/trading` — lives in `agent/src/broker/` (TypeScript,
`@modelcontextprotocol/sdk`, per the gateway-placement update in `robinhood-agentic-mcp.md`), but it
is a *separate* process/module from the agent's reasoning loop, is never registered as a tool the
agent can call, and only ever executes an order the Rust bridge has already approved: the bridge
returns an approval token bound to the intent's hash, and the gateway reports acks/fills back to the
bridge's OMS. Rohit owns the approval-token protocol (v1.1) on the Rust side; Satyam owns the TS
gateway shell. Net effect: even though the agent service and the gateway are both TypeScript in the
same repository area, there is no code path by which the LLM's own tool-calling loop can reach a
broker credential or a broker tool schema.

### 4. Approval token

`submit_order_intent`'s `intent_result` on `accepted: true` includes a token bound to a hash of the
normalized intent (instrument, side, qty, limit_price, request_id). The gateway (§3) refuses to
place any order whose token does not verify against that hash, so a compromised or buggy TS process
downstream of the bridge cannot alter an order after risk approved it. This is the same principle as
root rule 9 (venue keys scoped and trade-only): the token is scoped to exactly the intent that was
risk-checked, nothing broader.

### 5. Fake and live modes

`QC_AGENT_MODE=fake` (the default, and the only mode wired into CI) uses a deterministic
rule-based decider — for example, follow the classifier's signal when its max probability clears a
threshold, else `no_trade` — with no network call and no API key, so `just agent-sim` and CI can run
the whole loop end to end with a real (if simple) decision-maker. `QC_AGENT_MODE=live` uses the
actual Agent SDK and requires `ANTHROPIC_API_KEY` plus `scripts/ci/ai_gate.py` allowing the new
`autonomy/POLICY.yaml` entry `loop-agent-eval`, which this decision ships **disabled, at zero
budget** — a policy entry existing is not the same as it being on. `just agent-sim` builds
`qc-bridge`, runs the TS service in fake mode against `tests/replay/sample_day.csv`, and prints
decision/accepted/rejected counts plus the ledger's sha256; running it twice must produce identical
ledger hashes, which is the same determinism bar root rule 7 already sets for engine replay, now
extended to the fake-mode agent loop (live mode cannot meet this bar — see "the agent cannot be
honestly backtested" below — which is exactly why it is not the mode CI runs).

### 6. Decision ledger

Every `DecisionRequest`, the prompt version, the model id, the full SDK request/response (or a
`"fake"` marker in fake mode), the `Decision`, the risk verdict and the `IntentResult` are appended,
in order, to `out/agent/ledger.jsonl` (gitignored, append-only, schema `decision_ledger_entry`) —
the same "unrecorded backtests don't exist" posture root rule 6 already applies to the offline
research ledger, now applied to agent decisions. The ledger is what makes deterministic replay of a
recorded agent trajectory possible (see Chronicle, cited in Challenges) even though the live model
itself is not deterministic.

### 7. Learning-loop definition

"Learning" here is four separate, already-distinguished things (this repository's `docs/ARCHITECTURE.md`
§8 and ADR-0013 already draw this line for the classifier; this ADR extends it to the agent):

- **Predictive learning** (unchanged): the classifier retrains offline (existing L0-L3 path per
  ADR-0013), promoted only through the existing gates plus a human. The agent's decisions are never
  used as training labels for the classifier — separate from, but consistent with, the Anthropic
  usage-policy restriction on training on Claude's outputs (Challenges, below).
- **Agent learning**: prompt, tool and routing changes are *challengers*, evaluated against the
  champion on the frozen scenario suite (eval tier 2) and on forward/shadow decisions (eval tier 3),
  promoted only when both improve; failures go to the existing graveyard (root rule 6). A prompt
  change is a T2/T3 change under `autonomy/POLICY.yaml` like any other code change — memory notes
  written into a prompt are not a weight update and do not get a lower bar.
- **Research memory** (unchanged): outcomes recorded in the decision ledger become new labelled
  scenarios for the frozen suite and new research questions for the offline lab — the same
  ledger → graveyard → new hypothesis loop the lab already runs, now fed by live decisions too.
- **Authority stays bounded**: the agent can change *what it decides*; it can never change the risk
  limits, the kill switch, or the account funding. Those remain protected paths under root rule 3.

### 8. Eval tiers

Three tiers, cheapest and most frequent first (`llm-trading-eval-research.md` §5, and the Chronicle
and FORESIGHT-9 papers cited there):

1. **Every PR**: deterministic recorded-response replay (`just eval`, new `evals/` lane) — a
   Chronicle-style ("Cut-Point Replay for Regression Testing of LLM Agents", arXiv:2609.20625,
   accessed 2026-09-27) fixture pins a real or curated agent trajectory once; replay is bit-stable
   and makes zero model calls, so it is free and belongs in CI on every push. Includes the
   permission test proving no tool but `submit_order_intent` is callable, and the classifier
   regression suite on a frozen dataset.
2. **Every merge to main / before any live-capital change**: a small, frozen scenario suite in the
   FORESIGHT-9 style (arXiv:2608.29372, v2 2026-09-04) — counterfactual "worldlines" with a fixed
   baseline (buy-and-hold / no-trade / classifier-only) as the bar to beat, not zero. FORESIGHT-9's
   own finding is the right prior to start from: an equal-weight buy-and-hold baseline beat the LLM
   agents in 31 of 36 of their runs.
3. **Ongoing, nightly/scheduled, budget-capped**: prospective shadow-mode logging (predictions
   recorded, acted on with zero or minimal size) accumulated until a pre-planned sample size
   supports a claim, with any live-LLM-judge comparison corrected for multiple comparisons
   (Holm/Romano-Wolf) — per the "Ordinal Gates" replication critique
   (arXiv:2609.00187 plus its linked GitHub replication issue), a single-split, single-model result
   is exactly the kind of headline that does not survive robustness checks.

Live-LLM evals (tiers 2 and 3) are gated by `scripts/ci/ai_gate.py` and `autonomy/POLICY.yaml`'s
`loop-agent-eval` entry (disabled, zero budget as of this ADR) — this is a **partial disagreement
with the owner's "every PR runs an eval" framing**, recorded explicitly in Challenges below.

### 9. Rule 1 amendment

Root [CLAUDE.md](../../CLAUDE.md) rule 1 currently reads: *"No agent or LLM call in the live trading
path. No network calls to AI APIs from `engine/` or from any process that holds venue credentials."*
This ADR amends it for the trade-decision step only. The amended rule (to be applied to root
CLAUDE.md in the same PR that merges this ADR, by the claude-md lane, which owns CLAUDE.md files):

> **Rule 1 (amended by ADR-0040).** No agent or LLM call inside `engine/`, and no process that holds
> venue credentials ever makes one either. The one exception is the trade-decision step: a
> risk-wrapped agent service (Claude Agent SDK) may propose a trade through `submit_order_intent`,
> but it never holds a broker tool or credential, and every proposal is independently checked by the
> deterministic risk engine and kill switch before anything reaches a venue. This exception was
> decided in ADR-0040 (accepted by Satyam 2026-09-28, pending Rohit's approval) and needs a new ADR,
> not a CLAUDE.md edit, to change further.

This is the one non-negotiable-rule change root CLAUDE.md's own "Guidance versus enforcement"
section already anticipates needing two humans for; it is Accepted by one founder and explicitly
pending the other's approval, not silently rolled out.

## Alternatives

- **Keep LLM out of the order path entirely (the status quo, ADR-0010's Decision point 1).**
  This remains the safer default and is what ADR-0010 chose for exactly the reasons repeated in
  Challenges below (latency, determinism, leakage). Not chosen here because the owner's explicit
  request is to test whether an agent's judgment adds value over the fixed rule, measured honestly
  (forward-only, tiered evals) rather than assumed either way.
- **`@anthropic-ai/sdk` + `client.beta.messages.tool_runner` (or a manual tool-use loop) instead of
  the Agent SDK.** `agent-sdk-research.md` flags this directly: the Agent SDK "is literally Claude
  Code packaged as a library" — it shells out to a bundled Claude Code binary and ships the full
  harness (subagents, skills, hooks, sessions) even though this use case needs none of that; the
  plain SDK's tool runner or a manual loop maps more naturally onto "one call decides, using only
  the tools we define" and has a much smaller trusted surface. **Kept as the Agent SDK per the
  owner's explicit instruction** ("agent built with the npm Agent SDK"), with `tools: []` stripping
  the unneeded harness surface as the mitigation (§3 above). If the isolation pattern in §3 ever
  proves insufficient in practice, the plain SDK is the documented fallback with less to strip.
- **Robinhood Crypto Trading API adapter without an agent.** Still valid, and still the lowest-risk
  Robinhood path (`robinhood-research.md` §6: signed REST, Ed25519, published rate limits, an
  explicit invitation to build a custom application). This is not superseded — it remains available
  as a broker adapter with no agent in front of it — but it is not what this ADR is about, since the
  owner's request is specifically to add an agent to the decision step, and the Crypto Trading API
  alone does not exercise that.
- **Kalshi directly, for event contracts.** Still the better fit than Robinhood if the first
  vertical ends up being event contracts (`robinhood-research.md` §6: official REST/WebSocket/FIX,
  published rate tiers, a demo environment with mock funds — none of which Robinhood offers).
  Independent of this ADR; the first-vertical choice (ADR-0003/ADR-0020) is unchanged by this
  decision.

## Consequences

- `engine/crates/bridge/` and `agent/` become new call sites with their own lifecycle; both are
  T2 by default under `autonomy/POLICY.yaml`, and `agent/` ships one new, disabled, zero-budget
  policy entry (`loop-agent-eval`) rather than an enabled one.
- The decision ledger (`out/agent/ledger.jsonl`) is Internal data by the same classification
  `docs/security/data-classes.md` already applies to the existing experiment registry; it is not
  committed, matching the registry's own gitignore pattern for run artifacts.
- `scripts/ci/ai_gate.py` gains a second gated capability (agent live-mode evals) alongside its
  existing knowledge-loop gating; the gate's own file stays a protected path (already true today).
- Removing the agent step is a configuration change (set `QC_AGENT_MODE` to a decommissioned state
  and stop calling `qc-bridge`'s agent-facing ops), not a rewrite — `qc-bridge`'s own
  `next_decision_request`/`submit_order_intent`/`no_trade`/`status` surface has no agent-specific
  assumption baked into the risk/OMS path, since risk and OMS do not know or care where an intent
  came from.
- This ADR does not itself unblock M1 (first vertical) or A6 (first live agentic trade, see
  `docs/ROADMAP.md`); those still need their own separate decisions and, for A6, both founders'
  sign-off plus the counsel review below.
- `docs/ROADMAP.md`'s deferred row "Decision layer and Jev (#4)" is unaffected — Jev is a different,
  still-deferred call site (control-plane triage) with no trading authority; this ADR does not
  change ADR-0010's Decision or Alternatives.

## Challenges to the owner's plan, with evidence

Each item below either contradicts, or materially qualifies, a specific phrase in the owner's
original request. Sources are copied from the research files with their access dates; anything the
research files could not confirm from a primary source is marked **UNVERIFIED**.

1. **"HFAT" (high-frequency agentic trade) is not achievable as stated, measured against real
   latency.** `agent-sdk-research.md` §6, synthesizing Anthropic's own documented figures (Batch API
   "most batches completing within 1 hour"; prompt caching's qualitative latency benefit, no
   quantified number) with third-party benchmarks (**UNVERIFIED against Anthropic sources**,
   Artificial Analysis, accessed 2026-09-27, prior model generation): Claude Haiku 4.5 TTFT ≈0.63s,
   Sonnet 4.5 TTFT ≈1.52s. Combined with network round trips (service → Anthropic → service →
   bridge → risk → back), a realistic end-to-end floor is **roughly 1-5 seconds for a single-turn
   structured decision, and 5-15+ seconds for a multi-turn exchange** — orders of magnitude away
   from HFT's microsecond-to-low-millisecond cadence, and no SDK configuration closes that gap (it
   is a different latency class: network round trip to a hosted model vs. co-located execution).
   **Resolution adopted in this ADR:** define the milestone as A6, "the first agentic trade," and
   measure the real p50/p99 latency once `qc-bridge`/agent-service exist, rather than assuming a
   frequency the evidence rules out; keep "HFAT" only if redefined as "the highest frequency our
   measured loop supports."

2. **The agent cannot be honestly backtested on history — this is a stronger claim than "results
   might be optimistic."** `llm-trading-eval-research.md` §1: an LLM's pretraining corpus already
   contains text describing how a historical period unfolded, so asking it to "predict" that period
   can be scoring recall, not skill (Zhang & Stadie, "Temporal Leakage in LLM Backtesting,"
   arXiv:2608.02985, 2026-08-04, accessed 2026-09-27: the standard pre/post-cutoff split is *not*
   sufficient on its own, because models legitimately know more about periods close to their
   cutoff, and recency mimics leakage even when it isn't). Gao/Jiang/Yan (arXiv:2512.23847, accessed
   2026-09-27) show LLM forecast accuracy is inflated specifically on high-"lookahead-propensity"
   dates — direct evidence that reported backtest accuracy is partly memorization. **Resolution
   adopted:** the classifier is backtested historically (unchanged, existing walk-forward path); the
   agent is evaluated forward-only — recorded shadow (eval tier 3), then canary (A6) — never scored
   on a historical "prediction." Where pre-cutoff history must be reused at all, mask/anonymize per
   the KTD-Fin pattern and treat the result as a lower bound, not a point estimate.

3. **Eval cadence must split by cost and determinism, not run identically "on every PR."**
   `llm-trading-eval-research.md` §5: Chronicle-style recorded-response replay is near-zero cost and
   belongs on every PR; live-LLM evals are the expensive, nondeterministic tier and, per the
   Ordinal-Gates replication critique (arXiv:2609.00187 plus its linked GitHub issue, both accessed
   2026-09-27), a single-split live-LLM result that looks statistically significant can evaporate
   under walk-forward validation and multiple-comparison correction. **Resolution adopted:** the
   three-tier structure in Decision §8 — this is an explicit, partial disagreement with the owner's
   "run an eval on every deploy / PR merge" framing as originally stated; deterministic evals run on
   every PR, live-LLM evals run on merge/nightly and are budget-gated.

4. **Parallel agents need equal-token-budget evidence before they are adopted, not assumed to help.**
   `llm-trading-eval-research.md` §2: Tran & Kiela (arXiv:2604.02460, accessed 2026-09-27) show the
   reported multi-agent advantage in prior trading-agent papers (TradingAgents, FinAgent, FinCon) is
   largely an artifact of uncontrolled compute — multi-agent setups silently use more total tokens —
   not an architectural benefit; a 2026-08-31 survey of the field (arXiv:2608.31041) independently
   reaches the same reading ("multi-agent systems rely heavily on aggregation... strong model
   capability does not reliably translate into trading performance"). Kim/Garg/Peng/Garg
   (arXiv:2506.07962, ICML 2025, accessed 2026-09-27) show instances of the same base model have
   **correlated errors** (two models agree ~60% of the time when both are wrong, and larger/more
   accurate models are *more* correlated, not less) — so a debate/vote among same-family agents is
   not a variance-reduction ensemble. **Resolution adopted:** parallel agents (A7) ship only if they
   beat one agent at equal token budget on the forward eval; if genuine diversity is wanted, it has
   to come from different model families or a non-LLM component, not from prompting one model into
   different "roles."

5. **First asset: a liquid ETF, not crypto, is the cheaper choice for a minimal-money,
   many-round-trips loop.** `robinhood-agentic-mcp.md` §5: equities/ETFs are commission-free with
   sub-cent regulatory fees; crypto's default routing costs ~$0.95 per $100 notional each way
   (~$4.75 round trip on $500, June 2026 rate) — roughly 1% each way vs. basis points for a liquid
   ETF. **UNVERIFIED**: which fee regime (default spread vs. tiered exchange) actually applies to a
   `place_crypto_order` call inside an Agentic account specifically. **Resolution adopted:**
   recommend a liquid ETF as the default first asset for the agentic-account learning loop
   specifically (independent of the separate first-vertical choice for the classifier/engine work in
   ADR-0003/ADR-0020, which may still be Kalshi or crypto perps) — founders decide in A0, defaulting
   to whichever the research shows cheaper for small, frequent trades unless 24/7 market access
   outweighs it.

6. **Robinhood's Agentic account has no configurable spending cap, and revocation is not
   retroactive — our own gateway, not Robinhood, has to be the actual limit.**
   `robinhood-agentic-mcp.md` §3, quoting Robinhood's own support docs: "if you've asked your agent
   to take action without asking your approval, it can place trades without your confirmation" — no
   per-order or per-day dollar cap is a platform setting. Customer Agreement §29.8 (quoted in the
   same file): revocation is not retroactive — "you shall remain bound by... any instruction
   submitted by such agent and received by Robinhood prior to the effective processing of such
   revocation." **Resolution adopted:** the risk-wrapped gateway (Decision §3-4) enforces the actual
   per-order and per-day dollar caps, order-rate caps, and a kill switch that stops new intents at
   the gateway — never assume disconnecting the agent in the Robinhood app is sufficient on its own.

7. **Wash-trade / spoofing liability sits entirely on us, "regardless of whether such conduct was
   intended."** `robinhood-agentic-mcp.md` §6, Customer Agreement §29.8 (quoted): the account holder
   is "solely responsible for ensuring... compliance with... prohibitions on market manipulation,
   spoofing, layering, wash trading, marking the close," and explicitly "acknowledge[s] that orders
   and trading patterns generated by an AI agent... may give rise to such conduct... regardless of
   whether such conduct was intended by you." **Resolution adopted:** the gateway includes
   self-cross prevention (refuse an order that would trade against our own resting order on the
   same instrument) as a named requirement on Rohit's bridge/gateway lane, not left to the agent's
   own judgment.

8. **Anthropic's usage policy names financial decisions high-risk, and separately forbids training
   on Claude's outputs — both are open legal questions, not resolved by this ADR.**
   `agent-sdk-research.md` §7, quoting the Usage Policy: "Use cases related to financial decisions,
   including investment advice..." require "a qualified professional in that field [to] review the
   content or decision prior to dissemination" — in tension, on a literal reading, with an
   autonomous agent that decides and places an order without a human in the loop; whether this
   reaches a firm's own proprietary trading (no external "end user") versus consumer-facing advice
   is "genuinely ambiguous from the policy text" per the research file. Separately, the Commercial
   Terms of Service §D.4 and the Usage Policy both bar "utilization of inputs and outputs to train
   an AI model... without prior authorization" — a bright-line restriction, not gray area, directly
   relevant to point 7(b) of the owner's original framing ("learns from the offline lab cycle").
   **Resolution adopted:** Decision §7 above already restricts the classifier to training only on
   our own outcome labels, never on the agent's outputs, independent of this open question; both
   items are flagged **requires counsel** and are explicit blockers on A6 (first live trade) in
   `docs/ROADMAP.md`, not treated as resolved by shipping code.

9. **Robinhood's consent and personal-use clauses create a real gap between "founders trading their
   own accounts" and "a startup's product."** `robinhood-agentic-mcp.md` §6, Customer Agreement
   §29.1 ("You may not use the API Package or develop Licensee Products without Robinhood's express
   written consent"), §4.11 ("No Business Use... personal, non-business, non-commercial use"),
   §29.7(d) (API use "solely for your own personal use"). The research file's own reading: "each
   founder trading their own account, with their own decisions, using a shared piece of code they
   built, is closest to the personal-use pattern... the moment the trading engine is described or
   operated as a company product/service... it risks tripping §4.11 and §29.1's separate consent
   requirement." **Resolution adopted: requires counsel**, tracked as an A0 blocker in
   `docs/ROADMAP.md`/`docs/NOW.md`, not assumed resolved by Robinhood's own docs inviting custom
   clients to connect.

## Review date

Before A3 (Robinhood adapter behind the risk wrapper) starts, or immediately if Anthropic's Usage
Policy, Commercial Terms, or Robinhood's customer agreements change, or if Rohit's review surfaces a
disagreement with the pipeline shape in Decision §1-4.
