# Roadmap

Updated 2026-09-28. What must be true for an offline engineering foundation, what the first
specialization adds, and what is deferred and why. Current state is in
[docs/reports/base-status.md](reports/base-status.md); the week-to-week view is
[docs/NOW.md](NOW.md).

## M0: offline engineering foundation (met on `main` `013f3b1`, 2026-09-28)

An identified, reproducible checkout on `main` that either founder can set up, check, and use to
run one genuine offline end-to-end fixture demo, with its interfaces, limits and unfinished work
written down. It needs no venue, no credentials and no paid service.

Definition of done:

- [x] The bootstrap PRs are merged into `main` ([base-status](reports/base-status.md#how-the-prs-were-merged));
      this documentation PR (#8) merges last.
- [x] `just setup` and `just check` exit 0 on a fresh clone of `main`, and CI (`ci.yml`) passes
      on `main`.
- [x] `just replay` reproduces the committed order-log hash twice on the committed fixture.
- [x] `just walkforward demo` runs end to end and writes its report and registry rows to a known
      place (gitignored `out/`) (it may, and on synthetic data does, end in FAIL).
- [x] Interfaces, risk checks and kill-switch behavior documented as built (this PR)
      ([ARCHITECTURE](ARCHITECTURE.md), [kill-switch runbook](runbooks/kill-switch.md)).
- [x] Known defects recorded with owners: the unreachable deflated-Sharpe gate, the SimVenue fill
      limits, the unenforced review rules.
- [x] Study 0001 recorded with a decision (REJECT and INSUFFICIENT EVIDENCE are acceptable).

M0 does not require L0-L3 learning, autonomy loops, the decision layer, a live track record,
multi-agent services or a chosen venue.

## A0-A7: the agentic pipeline (blocked on human decisions)

[ADR-0040](adr/0040-agentic-decision.md) (Accepted by Satyam 2026-09-28, pending Rohit's approval)
replaces the old M1 plan ("first specialization": pick a vertical, wire a venue adapter, evaluate
in shadow) with A0-A7, built around an agent that makes the final trade decision. The old M1 steps
are folded into A3-A5 below. Two build waves (PRs #56-#61 and #72-#87, 2026-09-28) built A1, A2 and
a mock-tested A3 scaffold in fake/replay mode on the owner's instruction, without Rohit's review —
see [TEAM.md's exception log](TEAM.md#review-and-the-enforcement-gap). Nothing here has placed a
live order or called a real broker; nothing places one before A6, which needs both founders'
explicit sign-off separately from any ADR.

| Milestone | What it does | Exit test | Status | Owner |
|---|---|---|---|---|
| A0 Decisions | ADR-0040 accepted by both founders; first asset chosen (a liquid ETF is the ADR's recommendation; `config/instruments/spy.toml` exists as a placeholder, "asset pending #21"); counsel review requested; Agentic beta account access confirmed | ADR-0040 accepted by both founders, recorded in its Status line | **Not met.** Accepted by Satyam only (issue #20); asset (#21), spend caps (#23) and counsel review (#24) all still open | Satyam, Rohit |
| A1 Handoff contract | `DecisionRequest`/`Decision` JSON schemas (`schemas/decision/v1/`, now v1.2.1); the `qc-bridge` crate; the agent service (fake/replay deciders); a permission test | `just agent-sim` green, deterministic ledger hash across two runs; a test proves no tool but `submit_order_intent`/`no_trade` is callable | **Met.** `just agent-sim` deterministic; `agent/tests/permission-e2e.test.ts` drives the real SDK permission engine and proves every other tool call is denied (PRs #58, #61, #74) | Rohit (bridge), Satyam (agent service) |
| A2 Evals | `just eval` deterministic recorded-response suite on every PR; a paid live-LLM agent eval on merge to main and nightly, gated by `scripts/ci/ai_gate.py` and the disabled `loop-agent-eval` policy entry | Deterministic suite green on every PR; the paid tier stays off until a human enables it with a real budget | **Met.** `just eval` is 7/7 on every PR (replay, risk incl. black-box bridge sessions, walk-forward regression, registry, study guard, `agent_sim_fake`); Tier 2 stays gated off, zero budget (PRs #56, #79) | Satyam |
| A3 Broker | Robinhood Agentic MCP gateway adapter behind the risk wrapper (`agent/src/broker/`), tested only on recorded responses; an external kill switch; position and cash reconciliation | Recorded-response and chaos tests pass; the approval-token path is proven end to end with no live call | **Scaffold met; real connection not.** Approval verification, idempotent submit, cancel, reconcile, an external `--kill-file` + watcher thread, and a heartbeat that drains halt-cancels at the broker are all built and tested against a mock Robinhood MCP server (PRs #73, #75, #76, #84, #85, #87). The real network adapter needs issue #26 (a real account to learn tool schemas from) | Rohit |
| A4 Data + classifier | Point-in-time data capture for the chosen asset with the quality checks in `data/quality/`; classifier retrained on real data through the existing lab; walk-forward gates, including the deflated-Sharpe threshold decided (not left at the impossible default) | A classifier passes every walk-forward gate on real data, or the study is recorded REJECT/INSUFFICIENT EVIDENCE honestly | **Not started.** A mock-tested quote recorder exists (`agent/src/recorder/`, PR #82) but has never run against a real feed; the DSR threshold (#22) is undecided; study 0002 (favorite-longshot v2, PR #78) is a Kalshi study, not this asset's edge study (#67) | Shared |
| A5 Shadow | The agent decides on live data; orders go only to SimVenue/paper, ≥ 14 days | Forward metrics beat both a classifier-only baseline and a no-trade baseline (research shows a dumb baseline often wins this comparison — see ADR-0040 Challenges); every shadow day replays identically from its recorded trajectory | **Not started.** Blocked on A4 (a real-data classifier) | Both founders review |
| A6 First agentic trade | A funded agent account, limit orders only, a hard per-order and per-day dollar cap, both founders approve before it starts, daily reconciliation | Both founders' explicit sign-off recorded; zero cap or self-cross/wash-trade hits over the canary window; reconciled every day | **Not started.** Self-cross/wash-trade/daily-notional checks exist as placeholder limits (issue #23 undecided); no funded account | Both founders sign; automatic demotion on any breach |
| A7 Learning loop on | Decision-ledger outcomes become new frozen scenarios; prompt/tool changes are challengers evaluated against the champion before promotion; a parallel-agent experiment ships only if it beats one agent at equal token budget on the forward eval | A challenger beats the champion on the frozen suite and on forward shadow before promotion; a graveyard entry for every rejected challenger | **Scenario generator and promotion pipeline built** (issues #52, #53 closed, PR #83; forward tier reports `UNAVAILABLE` until A5 produces a shadow ledger). The parallel-agent experiment (#54) and the measured-cadence "first HFAT" redefinition (#55) are not started | Satyam (eval), Rohit (infra) |

Live trading, even limited (A6), is a separate decision from any ADR and needs explicit,
recorded sign-off from both founders every time, not just once.

### "First HFAT": the honest cadence (issue #55)

[docs/reports/latency.md](reports/latency.md) (PR #81, 2026-09-28) measured every plumbing
component of the loop (raw bridge round trip, decide step, full loop) in fake and replay mode: all
sub-millisecond at p99. **Adopted statement:** *"first HFAT" is one decision every roughly 1-5
seconds at best (single-turn, live mode, UNVERIFIED third-party estimate for a prior Claude
generation), never faster, because the model's own response time — not our network, engine, or
agent-service code — is the bottleneck.* This replaces any framing of "high-frequency" in the
traditional trading sense. Live-mode latency itself is not yet measured (no API key used anywhere
in this repo); Robinhood's real rate limits are separately unverified (issue #27). Both founders'
recorded acknowledgment of this redefinition — the remaining acceptance criterion of issue #55 — is
still open.

## Deferred

| Item | Reason | Revisit when |
|---|---|---|
| NautilusTrader, hftbacktest (ADR-0001) | Proposed only; the custom `qc-*` crates are what run. LGPL needs legal review | ADR-0001 is decided |
| MLflow (ADR-0005) | JSONL registry is enough for one study | Trial volume or lineage needs outgrow JSONL |
| Autonomy loops B-H (#3) | Need breakers, an App token, a second approver | M0 merged and review is enforceable |
| Decision layer and Jev (#4) | No call site has a measured need; distillation blocked by MCA §2.3(b); unaffected by ADR-0040 (different call site, no trading authority) | A call site shows a measured need |
| L0-L3 learning (#2) | Needs a validated signal and labels; agent-side learning (challenger prompts/tools) is A7, not L0-L3 | A signal survives forward shadow |
| RD-Agent, qlib sandbox | Multiplies trials before one baseline exists | After study 0001 and one more cycle |
| Agent eval suite (coding/autonomy agents) | Build from the first workflow's real failures | Failures are logged |
| Live agent decisions, real Robinhood connection, first agentic trade (ADR-0040 A3 real network call, A5, A6) | Counsel review outstanding (Robinhood consent/personal-use, Anthropic high-risk-use and no-training-on-outputs clauses); `loop-agent-eval` disabled, zero budget; issue #26 needs a real account | Counsel clears the open questions; both founders sign A6 |
| Market-holiday/early-close calendar in `qc-bridge`'s trading-hours gate | Hand-rolled US DST only; a real deployment needs a real tz/holiday-calendar crate | A real venue connection is imminent |
| Real daily reconciliation on a schedule (issue #45's cron side) | The reconcile mechanism itself is built (bridge + gateway); only the "run it daily automatically" wiring is deferred | A3's real connection lands |
| sops/age encryption, plugin marketplace, managed settings | No threat model; plans unknown | Threat model written |
| Metric ratchet | Replaced by invariants plus justified tolerances (research-loop §8) | Not planned |
| Second vertical | Scope rule: one implementation | First vertical has a reconciled record |

## History: the Final Base "base complete" checklist

Preserved from [docs/specs/0005-final-base.md](specs/0005-final-base.md) Phase 5. Status as of
2026-09-28 in brackets.

- ADR-0020 and ADR-0021 human-approved [0020 Proposed, 0021 not written]
- Audit complete, cuts in ROADMAP with code removed [audit in #14, no code removed]
- Core contracts implemented once, no vertical code in core [partial: `qc-*` traits, no `Instrument`/`MarketFamily`]
- Vertical adapter tests pass against demo; replay determinism on vertical data [not started; replay on synthetic data only]
- End-to-end paper trading in demo with full risk engine, kill switch tested [not started; `just paper` refuses]
- Slow-signal path rejects stale, unsigned, over-influence; leakage-flagged features blocked [not started]
- L0-L3 run for the vertical in shadow or offline with demotion tested [not started]
- Autonomy loops within budget, weekly cost report [not started]
- Security green, zero High/Critical on `main`, hardening script run [CI green on `main` `013f3b1`, no known vulnerabilities; hardening blocked by plan (403)]
- Fresh-clone test to a passing PR without asking [not run]
- CLAUDE.md within budget, `/context` evidence, no references to removed paths [budgets met; `/context` not run]

### Proposed correction (for review, not adopted)

The checklist mixes an offline foundation with a live vertical, learning and autonomy. Proposal:
call M0 above "foundation ready" and use it as the only gate for building on the base; move the
vertical, paper-in-demo and slow-signal items to M1; move L0-L3 and autonomy to the deferred table;
never tag `v0.1.0-base` or write a "base complete" report until the M0 boxes are checked on `main`.
Both founders accept or amend this in the PR that merges this file.
