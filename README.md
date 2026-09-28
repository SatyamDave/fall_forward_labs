# Fall Forward Labs: quant-core

Private trading research and execution platform, in its foundation phase. A Rust engine replays
market events through risk checks and an order manager against a simulated venue; a Python stack
builds point-in-time datasets, runs walk-forward validation and records every trial. Nothing
trades, nothing connects to a venue for trading, and no strategy has shown an edge.

| Audited | Value |
|---|---|
| Date | 2026-09-28 |
| Audited revision | `main` `013f3b1`: PRs #1-#7, #9-#17, #19, #56-#61 and #72-#87 merged on the owner's instruction (two build waves, [base-status](docs/reports/base-status.md#how-the-prs-were-merged)); this docs-sync PR follows |
| Documentation verdict | **Complete** for `main` `013f3b1` plus this PR |
| Engineering foundation verdict | **Ready as an offline foundation**, with the agentic pipeline (ADR-0040) built through fake/replay mode and a mock-tested broker scaffold ([base-status](docs/reports/base-status.md#verdicts)). Not a trading system; no edge shown; no real broker connection |
| Live trading | Disabled and not built. `just paper` refuses; no real venue adapter exists (the mock Robinhood MCP server is test-only) |
| Venue connectivity | None real. Study 0001/0002's read-only client talks to Kalshi's public endpoints; the agent's broker gateway (`agent/src/broker/`) only talks to a synthetic mock MCP server in tests |
| Paid agent jobs | None. `QC_AGENT_MODE=live` and the four AI workflows run only if `scripts/ci/ai_gate.py` allows them under `autonomy/POLICY.yaml`, which denies today (`loop-agent-eval` disabled, zero budget); no `ANTHROPIC_API_KEY` exists |
| Auto-merge | Not enabled (`allow_auto_merge: false`); no workflow enables it |

Biggest open items: Rohit has not reviewed or approved ADR-0040, and the two build waves above
merged without his review, on the owner's explicit instruction ([TEAM.md exception
log](docs/TEAM.md#review-and-the-enforcement-gap)); review is not platform-enforced on this GitHub
plan (403); no real Robinhood connection exists (issue #26 needs a real account); the first asset,
spend caps and DSR threshold are undecided (issues #21-#23); study data lives off git (issue #69).

## Architecture decision: agentic final decision (ADR-0040)

[ADR-0040](docs/adr/0040-agentic-decision.md) (Accepted by Satyam, **pending Rohit's approval**)
moves the final trade decision to an AI agent, amending root `CLAUDE.md` rule 1 for that one step:
classifier (unchanged, deterministic) → `qc-bridge` (Rust, protocol v1.2.1) → agent service (TS,
Claude Agent SDK, only tools: `submit_order_intent`/`no_trade`) → risk engine + kill switch
(unchanged, authoritative, now with self-cross/wash-trade/daily-notional checks) → OMS → gateway
(approval-token verified, tested against a mock Robinhood MCP server) → SimVenue today / a real
Robinhood connection once issue #26 lands. An external `--kill-file` plus a gateway heartbeat can
now halt and cancel every open order even if the agent process is stuck, independent of the
decision loop. Alternatives, consequences and a "Challenges to the owner's plan, with evidence"
section are in the ADR itself; diagram in
[ARCHITECTURE.md](docs/ARCHITECTURE.md#agentic-decision-pipeline-adr-0040-current-plus-planned);
milestones A0-A7 in [ROADMAP.md](docs/ROADMAP.md#a0-a7-the-agentic-pipeline-blocked-on-human-decisions).

New here? Start with the illustrated [project guide](docs/guide/quant-core-guide.html) (open the
file in a browser; GitHub shows HTML as source). It explains every component, the safety model, and
the gated path to trading through Robinhood. [docs/STATUS.md](docs/STATUS.md) is regenerated on every
merge to `main` and every 30 minutes: open PRs, recent merges, ADR statuses, test and trial counts, CI on `main`.

## Contents

1. [Project and stage](#1-project-and-stage) · 2. [Current state](#2-current-state) ·
3. [What has been built](#3-what-has-been-built) · 4. [What you can run today](#4-what-you-can-run-today) ·
5. [Quickstart](#5-quickstart) · 6. [Architecture](#6-architecture) · 7. [Repository map](#7-repository-map) ·
8. [Research and learning](#8-research-and-learning) · 9. [Safety and operating boundaries](#9-safety-and-operating-boundaries) ·
10. [Working together with Claude](#10-working-together-with-claude) · 11. [Validation and known limitations](#11-validation-and-known-limitations) ·
12. [Decisions and dependencies](#12-decisions-and-dependencies) · 13. [Roadmap](#13-roadmap) ·
14. [Contributing, security, confidentiality](#14-contributing-security-confidentiality) · 15. [Documentation index](#15-documentation-index)

## 1. Project and stage

The ambition ([docs/VISION.md](docs/VISION.md)) is an auditable trading system that earns a
reconciled track record before any talk of a fund. The current stage is narrower: an offline
foundation that either founder can check out, verify and extend. The first market is not chosen:
ADR-0020 proposes Kalshi event contracts, ADR-0003 a crypto-perpetuals shortlist, and both are
Proposed pending the operators' jurisdiction.

## 2. Current state

- PRs #1-#7, #9-#17 and #19 were merged 2026-09-28 after agent reviews (COMMENT reviews, not
  approvals); PRs #56-#61 (the agentic handoff contract, offline) and #72-#87 (two further build
  waves: risk additions, a realistic SimVenue, the broker gateway and mock Robinhood connection,
  protocol v1.2/v1.2.1, evals and reports, ops, latency, the recorder, and the learning loop) were
  merged the same day on the owner's instruction, all without Rohit's review — a dated exception
  recorded in [TEAM.md](docs/TEAM.md#review-and-the-enforcement-gap) and
  [base-status](docs/reports/base-status.md#how-the-prs-were-merged).
- On `main` `013f3b1`, `just check` exits 0 with every suite executed, and CI (`ci`, `security`,
  `scorecard`) is green. Branch protection and rulesets return HTTP 403 on this plan.
- Unverified: the devcontainer (no docker on the verifying machine), any behavior on Linux or on
  a second founder's machine; live-mode (`QC_AGENT_MODE=live`) agent latency (no API key used
  anywhere in this repo); a real Robinhood connection (mock-only so far).

## 3. What has been built

| Component | PR | Runs? | Main limitation |
|---|---|---|---|
| Rust workspace, fixed-point core types | #1 | yes, 42 tests | Toolchain floats on `stable`, not ADR-0004's pin |
| Order book, OMS, risk checks, kill switch, SimVenue, replay | #15, #72, #75 | yes, `just replay` | Synthetic fixture; SimVenue models queue position and consumed liquidity (#30/#72), but its fill model is still simplified (no real depth) |
| Data schemas, quality checks, datasets, features, training, walk-forward, export, monitoring | #12 | yes, `just walkforward demo` | Synthetic data only; DSR gate mis-scaled |
| Rust inference with Python parity | #12 | tests only | Not wired into the engine |
| Experiment registry (JSONL, one ledger) | #1, #12, #17 | yes | Not MLflow (ADR-0005 says MLflow) |
| CLAUDE.md hierarchy, VISION, ARCHITECTURE | #7, #14 | n/a | Guidance, not enforcement |
| `.claude/` settings, hooks, rules, agents, skills | #11 | 62 hook tests | Hooks bind Claude Code sessions only |
| Knowledge-loop workflows and scope check | #10 | 16 tests | Never ran; gated off by POLICY.yaml |
| CI, security scanners, pre-commit, harden script | #13 | CI green on `main` | Harden script blocked by plan (403) |
| Autonomy tier policy, gate, AI-workflow gate script | #3, #17 | 29 + 17 tests | Loops not built; AI workflows denied by policy |
| Study 0001 favorite-longshot | #16, #17 | yes, from snapshot | INSUFFICIENT EVIDENCE; snapshot is off git |
| ADRs 0001-0006, 0010, 0011, 0013, 0020; plans; data classes | #2-#5, #9 | n/a | All Proposed |
| Contributor docs, templates, devcontainer (non-root) | #8, #17 | n/a | Devcontainer never built |
| ADR-0040 + docs (ARCHITECTURE/ROADMAP/NOW/TEAM, guide) | #60 | n/a | Accepted by Satyam only; **pending Rohit** |
| Handoff contract: `schemas/decision/v1/*` (now v1.2.1) + `qc-bridge`; agent service, fake/replay/gated-live modes; `just eval` + `eval.yml`; CLAUDE.md + arch-check | #56, #58, #59, #61, #74, #80 | yes, `just agent-sim`: the TS agent in fake mode drives the real Rust bridge over the synthetic sample day, identical ledger sha256 on two runs; a permission-e2e test proves only `submit_order_intent`/`no_trade` are callable | Synthetic data only; live mode never called; A1/A2 exit tests met |
| Risk additions: self-cross, wash-trade, daily-notional dollar cap | #75 | yes, `cargo test -p qc-risk` (15/15) | All three are placeholder values pending #23 |
| Protocol v1.1/v1.2/v1.2.1: Ed25519 approval stamps, `external` venue mode, `report_execution`, `kill`/`--kill-file` (+ dedicated watcher thread), `cancel_order_intent`, `reconcile`, per-instrument config, structured stderr event log | #76, #85, #87 | yes, `cargo test -p qc-bridge` (114 tests); watcher thread proven with zero stdin traffic | Only `UTC`/`America/New_York` timezones; no market-holiday calendar; `config/instruments/spy.toml` is a placeholder pending #21 |
| Broker gateway (`agent/src/broker/`) + mock Robinhood MCP server: approval verification, idempotent submit, cancel, reconcile, a heartbeat that drains halt-cancels at the broker even if the agent is stuck | #73, #76, #84, #87 | yes, `just agent-sim-external` (twice, identical ledger + journal hashes) | Real Robinhood tool schemas are UNVERIFIED (#26); no real network call anywhere |
| Evals, reports, learning loop: baseline-checked Tier 1 suite, ledger/PnL reports with a stop rule, ledger→scenario generator, champion/challenger promotion (never auto-promotes) | #56, #79, #83 | yes, `just eval` (7/7), `just report-ledger`, `just report-pnl`, `python3 scripts/eval/promote.py` | PnL is a decision-ledger estimate, not reconciled against a real venue (#45); forward tier `UNAVAILABLE` until a shadow run (#48) exists |
| Ops: live-trading runbook, fail-closed supervisor, secret-loading hook, alerting on halt/kill/reconciliation/repeated-rejects/spend-cap | #77 | yes, 26 ops tests; alerts fire against real `qc-bridge` stderr output (#85) | No real host provisioned; only the `env` secret-loading provider is implemented |
| Latency measurement, honest "first HFAT" definition | #81 | yes, `just bench-latency` | Fake/replay mode only; live-mode number is an UNVERIFIED third-party estimate; `docs/ROADMAP.md`'s publication is this docs-sync PR |
| Real-data price recorder (`agent/src/recorder/`), read-only tool allowlist | #82 | yes, `just record-quotes --dry-run` (proven against `qc-replay`) | No `config/instruments/**` wiring at merge time (landed before #85); never run unattended for a full trading day (#46) |
| Study 0002 (favorite-longshot v2, bounded population) | #78 | yes, `just study-0002`, from the archived snapshot | INSUFFICIENT EVIDENCE / UNDETERMINED on a real sample; fee schedule still unverified |

Per-component detail with evidence: [docs/audits/0001-reality-audit.md](docs/audits/0001-reality-audit.md)
(pre-dates the two build waves above; not yet refreshed for #72-#87).

## 4. What you can run today

On a checkout of `main`, offline, with no credentials:

| Command | Kind | What it does | Expected result |
|---|---|---|---|
| `just setup` | setup | `cargo fetch`; `uv sync --locked` | exit 0; creates `research/.venv` |
| `just check` | checks | fmt, clippy, ruff, mypy, all suites, audits | exit 0 |
| `just replay` | offline replay, simulated execution | Replays `tests/replay/sample_day.csv` twice, compares with the committed hash | `edbfa8a5...2d1` twice, `replay deterministic and matches the committed order log` |
| `just walkforward demo` | offline research demo | Synthetic day through features, training, walk-forward | Verdict FAIL, exit 0; writes only gitignored `out/` (`--record` writes the registry) |
| `just learnings` | knowledge | Counts inbox files | `0 untriaged learning(s)` |
| `just agent-sim` | agentic pipeline, fake mode | Runs the TS agent against the real `qc-bridge`/SimVenue twice | Identical ledger sha256 both runs, no network call |
| `just agent-sim-external` | agentic pipeline, mock broker | Agent (fake) → `qc-bridge --venue external` → gateway → a mock Robinhood MCP server → `report_execution`, twice | Identical ledger and broker-journal hashes; never a real broker |
| `just eval` | Tier 1 eval suite | Replay determinism, risk invariants, walk-forward regression, registry integrity, study guard, `agent_sim_fake` | exit 0, 7/7 pass, no paid call |
| `just report-ledger` / `just report-pnl` | decision reports | Summarize `out/agent/ledger.jsonl`: accept/reject rates, latency, cost, decision-ledger-estimate P&L vs. no-trade/buy-and-hold, a stop-rule check | Markdown + JSON in `out/reports/`; `report-pnl` exits non-zero if the stop rule trips |
| `just bench-latency` | latency measurement | Measures real bridge/decide/full-loop latency in fake and replay mode | p50/p95/p99/max table; feeds `docs/reports/latency.md` |
| `just record-quotes --dry-run` | price recorder, mock-only | Polls quotes through a mock Robinhood MCP server, writes a replay-store CSV + catalog entry | A few records written under `data/raw/`; no network |
| `just study-0002` | offline research demo | Reruns study 0002 (favorite-longshot v2) from its archived snapshot | `INSUFFICIENT EVIDENCE` verdict reproduced exactly |

Not available:

| Command or capability | Status |
|---|---|
| `just backtest <cfg>` | Placeholder; prints "not implemented" and exits 2 |
| `just paper <strategy>` | Refuses and exits 1 by design |
| `just study-0001` | Exits 2 on a fresh clone (snapshot is off git); reproduces `results.json` exactly from the preserved snapshot |
| `QC_AGENT_MODE=live`, any real Robinhood connection, live/paper/canary trading | Not built; gated off (`autonomy/POLICY.yaml`'s `loop-agent-eval` disabled, zero budget; no API key; no real broker) |
| Devcontainer | Not verified |

**The path to the first real trade** is not an engineering gap alone: A1 (handoff contract) and A2
(evals) are built and their exit tests pass; A3 (broker) has a mock-tested scaffold but no real
Robinhood connection (issue #26 needs a real account). What remains is mostly founder decisions —
ADR-0040 approval, the first asset, spend caps, counsel review (issues #20-#27, #71) — plus real
data and a two-week risk-free shadow run (A4-A5) before either founder can say go (A6). Full detail:
[docs/ROADMAP.md](docs/ROADMAP.md), [docs/NOW.md](docs/NOW.md).

## 5. Quickstart

Prerequisites, versions as verified on 2026-09-28 (macOS arm64): Rust/cargo 1.97.1 (the repo asks
for floating `stable` via `engine/rust-toolchain.toml`, honoured only with rustup), uv 0.11.28
(it provides Python 3.12 for `research/`), just 1.58.0, git, and read access to the private repo
`SatyamDave/fall_forward_labs`. Optional for a full audit: cargo-deny, cargo-audit, pip-audit;
without them `just audit` prints `SKIPPED (not a pass)`, exits 0 locally and fails in CI.

```sh
git clone https://github.com/SatyamDave/fall_forward_labs.git && cd fall_forward_labs
just setup    # downloads crates from crates.io and packages from PyPI
just check    # exit 0 on main 013f3b1
just replay   # the smallest offline end-to-end demo
```

Setup downloads dependencies; nothing needs venue credentials or makes a paid call. On the
verifying Mac, cold setup took about 6 s, `just check` 21 s and `just replay` 3 s; your times
depend on network and cache. Success looks like `replay deterministic`. Outputs: replay logs go
to a temp directory; walk-forward writes `backtest/reports/demo/<date>.md` and
`research/registry/log/`.

## 6. Architecture

```mermaid
flowchart LR
  subgraph offline["Offline research (Python)"]
    syn[synthetic data] --> ds[datasets + features] --> wf[walk-forward] --> reg[(JSONL registry)]
  end
  subgraph engine["Execution (Rust, no network)"]
    rec[synthetic recording] --> book[order book] --> strat[strategy] --> risk[risk + kill switch] --> oms[OMS] --> sim[SimVenue]
    sim --> oms
  end
  wf -. "model JSON + sha256 (parity tests only)" .-> inf[inference]
  venue["venue adapter, live data (planned)"]:::planned -.-> book
  classDef planned stroke-dasharray: 5 5
```

The engine is the in-house `qc-*` crates; NautilusTrader is only proposed (ADR-0001) and is not a
dependency. Interfaces, state transitions and failure behavior: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 7. Repository map

| Path | Purpose | Entry point | Canonical doc |
|---|---|---|---|
| `engine/` | Rust workspace, `qc-*` crates | `cargo test --workspace`, `just replay` | [engine/CLAUDE.md](engine/CLAUDE.md) |
| `research/` | uv project; registry; studies | `research/pyproject.toml` | [research/README.md](research/README.md) |
| `ml/`, `data/` | Model pipeline and data code (run in `research/`'s env) | `ml/validation/walkforward.py` | [ml/CLAUDE.md](ml/CLAUDE.md), [data/CLAUDE.md](data/CLAUDE.md) |
| `backtest/` | Configs and reports; fill and latency models are empty | `backtest/configs/demo.yaml` | [backtest/CLAUDE.md](backtest/CLAUDE.md) |
| `strategies/` | Template only; no strategy | `strategies/_template/` | [GATES.md](strategies/_template/GATES.md) |
| `config/` | Risk limits (protected), environments | `config/limits/default.toml` | [config/venues/README.md](config/venues/README.md) |
| `tests/` | Replay fixture, hook, knowledge, autonomy tests | `tests/replay/sample_day.csv` | [tests/replay/README.md](tests/replay/README.md) |
| `autonomy/` | Tier policy and classifier (protected) | `autonomy/classify.py` | `autonomy/POLICY.yaml` |
| `.claude/` | Settings, hooks, rules, agents, skills | `.claude/settings.json` | [how-this-repo-learns](docs/onboarding/how-this-repo-learns.md) |
| `.github/` | CI, scanners, knowledge loop, templates, CODEOWNERS | `.github/workflows/ci.yml` | [SECURITY.md](SECURITY.md) |
| `scripts/` | Repo hardening, knowledge scripts | `scripts/harden-repo.sh` | [github-hardening](docs/runbooks/github-hardening.md) |
| `agents/`, `ops/`, `fund/` | Placeholders (READMEs, one Terraform template) | none | their `CLAUDE.md` |
| `docs/` | Vision, architecture, ADRs, plans, specs, runbooks, reports | this README | §15 |

## 8. Research and learning

Implemented lifecycle: synthetic book events → quality checks (gaps, duplicates, skew) →
point-in-time dataset with a content hash → `tob-v1` features → logistic regression with a fixed
seed → purged, embargoed walk-forward with deflated Sharpe and PBO → trials and a challenger in
the JSONL registry → a dated report. Export writes a JSON model plus sha256 that the Rust
`qc-inference` crate loads and matches within tolerance in parity tests. Monitoring code demotes
automatically and refuses promotion without a human-approval record.

Nothing learns online, no model has seen real data, and nothing has been promoted past
challenger. "Learning" here means four separate things, and only the first two are partly built:

- **Research memory:** registry, [graveyard](docs/research/graveyard.md), study reports. Built.
- **Predictive training:** the ml pipeline above. Built, exercised on synthetic data only.
- **Agent and knowledge changes:** hooks and knowledge-loop workflows (#10, #11). Never ran.
- **Online adaptation (L0-L3):** ADR-0013 only. Deferred.

Study 0001 (#16) tested favorite-longshot bias on settled Kalshi markets under a pre-registered
design: INSUFFICIENT EVIDENCE, because the frozen listing cap dropped all 40 days and 0 markets
were analysed. The hypothesis is untested, not refuted. Process: [docs/process/research-cycle.md](docs/process/research-cycle.md).

## 9. Safety and operating boundaries

- **Risk checks** (`engine/crates/risk`, protected): kill switch, invalid order, stale data,
  daily loss, price band, notional, position, order rate, each with boundary tests. Limits come
  from `config/limits/default.toml` (unreviewed defaults).
- **Kill switch:** stops new submissions and sends cancel requests for working orders, in the
  simulated engine. Cancels are not confirmed, positions are not flattened, and no operator
  command engages it. The live/agent-facing engine (`qc-bridge`, ADR-0040) is different: an
  operator-touched `--kill-file` is observed by a dedicated watcher thread independent of the
  agent process's cooperation, and a halt mints a signed cancel approval the gateway's own
  heartbeat drains at the real broker (issue #44). [docs/runbooks/kill-switch.md](docs/runbooks/kill-switch.md).
- **Protected paths:** root [CLAUDE.md](CLAUDE.md) rule 3 plus `autonomy/`. `guard-protected.sh`
  blocks Claude Code Edit/Write there; Bash and humans are not blocked. No GitHub rule enforces
  review ([docs/TEAM.md](docs/TEAM.md#review-and-the-enforcement-gap)).
- **Secrets and data:** none in git; `.env*` denied to Claude Code by settings and hooks; raw data
  gitignored. Data classes for external providers: [docs/security/data-classes.md](docs/security/data-classes.md).
  A hosted coding assistant reading files is not local-only processing.
- **Human decisions:** anything touching risk, limits, capital, credentials, deployment, or
  evaluation integrity.

## 10. Working together with Claude

Start at [CLAUDE.md](CLAUDE.md) and [docs/NOW.md](docs/NOW.md). Shared instructions are committed:
root and nested `CLAUDE.md`, `.claude/rules`, skills and agents; `.claude/settings.json` is
protected. Personal memory is not a source of truth: checkpoint in the PR or NOW.md. Ownership
and handoffs: [docs/TEAM.md](docs/TEAM.md). Onboarding: [docs/onboarding/day-1.md](docs/onboarding/day-1.md).
Whether both founders' sessions load identical context has not been checked (`/context` is
interactive).

## 11. Validation and known limitations

Dated evidence: [docs/reports/base-status.md](docs/reports/base-status.md). In short:

- Passed on `main` `013f3b1`: setup, `just check` (all suites), audits, replay, CI; `just eval` (7/7).
- CI was red on `main` for two intermediate merges (#16, #6; bandit B310), fixed by #17.
- Not run or unavailable: devcontainer build, fuzzing, bench timings, codeql, AI reviews, live-mode
  (`QC_AGENT_MODE=live`) agent latency, any real Robinhood connection.
- Study 0001 and study 0002 cannot be reproduced from a clean clone; both snapshots are outside git
  until an approved shared store exists (issue #69).
- Remaining false greens: audit skips exit 0 locally; walk-forward exits 0 on FAIL.
- Synthetic fixtures establish mechanics and determinism; SimVenue now models queue position and
  consumed liquidity (#30) but is still not real fill/latency/edge evidence.

## 12. Decisions and dependencies

| Decision | Status | Blocks | Owner |
|---|---|---|---|
| ADR-0040 agentic decision; Robinhood/Anthropic counsel review (Challenges 8-9, issue #24) | Accepted by Satyam | A2 onward (already used to authorize two build waves), root CLAUDE.md rule 1, A6 | Rohit's approval, counsel |
| First asset for the agentic account (issue #21; sample `config/instruments/spy.toml` exists as a placeholder) and separately the engine/classifier vertical (ADR-0020 vs ADR-0003) | Proposed / undecided | A4, real recorder/reconciliation runs | founders |
| Spend caps: total funding, per-order/day dollar caps, canary size (issue #23; placeholder keys already exist in `config/limits/*.toml`, marked pending #23) | Undecided | A6 | founders |
| DSR promotion threshold (issue #22) | Undecided | Any real-data classifier promotion (A4) | founders |
| Robinhood real tool schemas and rate limits (issues #26, #27) | Unknown; mock-only scaffold built | Real broker connection (A3 completion) | Satyam, needs a real account |
| Operators' jurisdiction, entity; founders' legal/tax agreement (issue #71) | Unknown | Any venue account, first real trade | founders, with counsel |
| ADR-0001 NautilusTrader (LGPL-3.0 flagged for legal review in ADR-0002) | Proposed; not used | Engine dependency choice | founders |
| ADR-0004 toolchain pin (patch 0001), ADR-0005 MLflow | Proposed; code differs | Pin, registry migration | founders |
| TypeSafe MCA §2.3(b) distillation clause (ADR-0011) | Blocks decision-layer distillation | Decision layer | legal review |
| Second-approval / GitHub plan (issue #25) | Unresolved; two build waves merged without Rohit's review on the owner's instruction | Enforced review | founders |
| Rohit's approval of ADR-0040 and confirmation of the agentic ownership split (issue #20) | Unknown | A2 onward being anything but an authorized exception | founders |

## 13. Roadmap

M0 (offline foundation) is met. ADR-0040 replaces the old M1 plan with milestones A0-A7, built
around the agentic pipeline. A1 (handoff contract) and A2 (evals) are built and their exit tests
pass in fake/replay mode; A3 (broker) has a mock-tested scaffold (approval verification, kill
switch, reconciliation) but no real Robinhood connection; A7 (learning loop) has its
scenario-generator and promotion pipeline built. A0, A4, A5, A6 remain founder-decision- or
real-data-blocked. Full list, deferred items with reasons, and the historical "base complete"
checklist: [docs/ROADMAP.md](docs/ROADMAP.md). What remains before the first real trade:

**(a) Founder decisions/actions** — Rohit's review and approval of ADR-0040 (#20); the first asset
and its cost math (#21); the DSR promotion bar (#22); spend caps (#23); counsel review of
Robinhood's and Anthropic's terms (#24); the second-approval/GitHub-plan gap (#25); connecting a
real Robinhood account to learn its tool schemas (#26) and rate limits (#27); a founders'
legal/tax agreement (#71); then, later, the shadow-run go/no-go (#49) and the first-trade sign-off
(#51).

**(b) Code still to write** — a real (non-mock) Robinhood network adapter once #26 lands (#43); a
real-data price recorder run and classifier retrain (#46, #47); a real edge study on the chosen
asset (#67); daily reconciliation wired to a real schedule (#45); the two-week risk-free shadow run
itself (#48); the single-vs-parallel-agent experiment (#54); and publishing the measured trading
cadence with both founders' acknowledgment (#55, latency already measured in
[docs/reports/latency.md](docs/reports/latency.md)).

## 14. Contributing, security, confidentiality

[CONTRIBUTING.md](CONTRIBUTING.md) covers branches, commits, checks and PRs; the PR and issue
templates are in `.github/`. Report vulnerabilities privately per [SECURITY.md](SECURITY.md).
The repository is private and has no LICENSE file; it is not open source and must not be
published. No IP-assignment or founders' agreement exists in the repository; that is a task for
the founders and their counsel.

## 15. Documentation index

- **Founder:** this README → [NOW](docs/NOW.md) → [base-status](docs/reports/base-status.md) →
  [ROADMAP](docs/ROADMAP.md) → [TEAM](docs/TEAM.md) → [specs index](docs/specs/README.md).
- **Engineer:** [CONTRIBUTING](CONTRIBUTING.md) → [day-1](docs/onboarding/day-1.md) →
  [ARCHITECTURE](docs/ARCHITECTURE.md) → [engine/CLAUDE.md](engine/CLAUDE.md) →
  [kill-switch runbook](docs/runbooks/kill-switch.md) → [GLOSSARY](docs/GLOSSARY.md).
- **Researcher:** [research-cycle](docs/process/research-cycle.md) →
  [reality audit](docs/audits/0001-reality-audit.md) → [research/README.md](research/README.md) →
  [GATES.md](strategies/_template/GATES.md) → [graveyard](docs/research/graveyard.md) →
  [ADRs](docs/adr/).
