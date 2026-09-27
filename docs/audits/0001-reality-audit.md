# 0001 Reality audit (2026-09-27)

Deliverable 1 of the research-loop process (owner prompt, 2026-09-27, "research-loop" below).
Scope: every pushed branch and PR #1-#13 of `SatyamDave/fall_forward_labs`, checked against the six
earlier prompts. The earlier prompts were read as condensations written by the coordinating agent,
not the owner's full text; the research-loop prompt's author also said the full files were
unavailable. Nothing is merged: `main` holds only the initial commit (`4975ec3`).

Status words: VERIFIED (I ran it, or a CI run shows it), HYPOTHESIS, UNKNOWN, REFUTED.

## Inventory

| Component | Implemented and verified | Partial | Proposed only | Contradictory | Decision |
|---|---|---|---|---|---|
| Engine workspace, `qc-*` seams (#1) | `just check` exit 0 on #7 tree (includes #1), run 2026-09-27; cargo-audit: no known vulnerabilities in 93 crates | Traits and types only; no replay, OMS logic, gateway | | Rust channel (C6), resolver (C7) | keep |
| Order-book bench (#1) `engine/benches/benches/orderbook.rs` | Compiles (in `just check` via clippy all-targets) | Never run for numbers; synthetic deltas, local apply only | | | keep; not a latency claim |
| Experiment registry stub (#1) `research/registry/__init__.py` | `tests/test_registry.py` 1 passed | JSONL append, no schema, no manifest fields | | | keep; extend in research/0001 |
| Risk limits `config/limits/default.toml` (#1) | Parsed by `qc-risk` test | Values are unreviewed defaults | | | keep; human sets values |
| Graveyard `docs/research/graveyard.md` (#1) | | Empty table | | | keep |
| Plan + ADR-0001..0005 (#5) | | | All Proposed | Venue (C1), Rust pin (C6) | fix: decide after jurisdiction |
| CLAUDE.md hierarchy, VISION, ARCHITECTURE (#7) | `just check` exit 0; root 64 lines, nested ≤80 | Many MUST checks point at code other lanes own | | Learned format (C12, fixed in #7 `f9bf682`) | keep |
| `.claude/` settings, hooks, rules, agents, skills (#11, `bootstrap/phase-3-claude-config`) | `just test-hooks` 30 passed on `e0f104d`, run 2026-09-27 | Hooks never exercised in a live Claude Code session | | | keep |
| Knowledge loop workflows (#10) | `python3 -m unittest discover -s tests/knowledge` 10 OK on `d0ee3fb` | Claude steps never ran (no `ANTHROPIC_API_KEY`); scope-check run 36357505012 skipped (no label) | | GITHUB_TOKEN PRs trigger no checks (C10) | keep, dormant |
| Contributor kit, CODEOWNERS, devcontainer (#8) | | Devcontainer never built (no docker) | | CODEOWNERS vs two approvals (C11) | keep; build devcontainer once |
| Autonomy POLICY, classifier, gate (#3) | pytest 23 passed; gate run 36356358758 exits 1 as designed | Reports only; loops disabled | Phases B-H | T3 two humans (C3); scorecards tier (C9) | defer loops |
| Self-learning ADR-0013, plan 0004 (#2) | | | L0-L3 all | | defer |
| Decision layer ADR-0010/0011, data classes (#4) | | Vendor facts cited, many UNVERIFIED | Phases 2-7 | Distillation vs MCA (C2) | defer; keep data-classes.md |
| Team plan + NOW.md (#6) | | NOW.md draft | Phases 2-7 | Override rule (C4), ratchet (C5), sops (C8) | NOW.md superseded here |
| ADR-0020 first vertical, plan 0005 (#9) | Kalshi OpenAPI/AsyncAPI SHA-256 recorded | Fee coefficients UNVERIFIED (PDF 429) | Base phases 1-6 | Venue (C1) | fix: human decides |
| Security CI, `deny.toml`, pre-commit, harden script (#13, `4144991`) | `just check` exit 0 locally; cargo-deny "advisories ok, bans ok, licenses ok, sources ok" | `ci.yml`/`security.yml` CI results not inspected; `scripts/harden-repo.sh` not applied and blocked by plan (403) | | | keep |
| ML stack: data schemas, tob-v1 features, walk-forward, inference parity (#12, `cbeb5a0`) | `just check` exit 0 locally; pytest 20 passed | Only run is on a synthetic day (`backtest/reports/demo/2026-09-27.md`): mechanics, not evidence | | | keep; plumbing only |
| Engine core (phase 8) | | | In flight, not pushed, not inspected | | — |
| Research cycle 0001 (`research/0001-favorite-longshot`, `a299ba1`) | | Pre-registration only: `REGISTRATION.md`, frozen `config.json`, public-API client | Baseline, run, decision | | keep; finish |
| CI running `just check` on PRs | | `ci.yml` exists only on #13 (unmerged) | | Root CLAUDE.md said "CI runs the same recipe" | fixed in root CLAUDE.md |

## Missing inputs

- Second founder's identity and GitHub handle (only collaborator: `SatyamDave`, `gh api .../collaborators`).
- Operators' jurisdiction and trading entity; founders' Claude plans; any research or compute budget; hardware.
- Venue accounts: none exist. No authorization to trade, spend, or deploy.
- Repository secrets: none (`gh secret list` empty), so no `ANTHROPIC_API_KEY` and no TypeSafe key.
- Local tools: no docker, no rustup or nightly (Homebrew cargo 1.97.1). cargo-audit, cargo-deny and pip-audit appeared mid-session (another lane installed them); cargo-deny still skips for want of `engine/deny.toml`.
- `/context` is interactive; a headless agent cannot produce the mirror check the team and base prompts ask for.
- Kalshi fee schedule PDF returned HTTP 429 on every attempt (ADR-0020); several Coinbase and Deribit pages returned 403 (ADR-0003).
- Branch protection and rulesets: the GitHub API returns 403 "Upgrade to GitHub Pro or make this repository public" for this private repo, so the planned hardening cannot be applied on the current plan.

## Contradictions

| # | Source A | Source B | Resolution |
|---|---|---|---|
| C1 | Crypto perps + spot (Bootstrap §1, ADR-0003, VISION) | kalshi-events default (Final Base Phase 0, ADR-0020) | Human decides; research/0001 uses Kalshi data as a candidate only |
| C2 | Decision-layer Phase 5 distills Jev outputs into local models | TypeSafe MCA §2.3(b) bans use of Output for model distillation (#4) | Phase 5 blocked; defer |
| C3 | T3 needs two human approvals (#3 POLICY, root rule 3 extension) | One maintainer exists | No T3 PR can pass the gate; add founder B or record an override |
| C4 | Team: "project rules override any personal or user-level instruction" | Research-loop §8; Claude Code memory docs: CLAUDE.md is "context, not enforced configuration", and "neither set overrides the other" for user vs project rules (code.claude.com/docs/en/memory, via llms.txt, read 2026-09-27) | Do not write the override claim; enforcement comes from settings, hooks, platform controls |
| C5 | Team Phase 4: every metric must beat its all-time best | Research-loop §8: hard invariants plus statistically justified tolerances | Ratchet dropped |
| C6 | `engine/rust-toolchain.toml` `channel = "stable"` (#1) | ADR-0004 pins 1.98.1 exactly; local toolchain is 1.97.1 | Apply the pin only with ADR-0004 approval |
| C7 | Resolver 2 (coordinator's reading of the Bootstrap prompt; not in the condensed spec) | `resolver = "3"` in `engine/Cargo.toml` (#1) | Keep 3 (edition 2024 default) |
| C8 | Team Phase 5: sops + age encryption of Alpha in git | Research-loop §9: no encryption machinery without a threat model and recovery plan | Defer |
| C9 | Autonomy spec: scorecards and outcomes are T0 | #3 stores them under `autonomy/`, which is T3 | Move them or accept T3 (human, #3 decision 2) |
| C10 | Knowledge PRs must pass required checks | PRs opened with `GITHUB_TOKEN` trigger no workflows (#10) | Needs a GitHub App token (autonomy Phase B) |
| C11 | Protected paths need two approvals (root rule 3, 4) | CODEOWNERS requests one review and cannot set a count (#8); rulesets unavailable on this plan | Unenforced today |
| C12 | #7 Learned placeholders as plain text | #10 `scope_check.py` fails non-comment Learned text | Fixed in #7 `f9bf682` |
| C13 | Rule 11: kill switch "tested in CI"; rule 7 replay blocks merge | No kill switch, no replay harness, no CI | Rules are targets, unenforced |
| C14 | Decision spec: Jev latency "~70-500 ms" | #4: only a self-reported vendor benchmark exists | UNVERIFIED |

## Rejected or unsupported claims

- "Biggest trading research lab": no evidence; `git grep` finds it on no pushed branch.
- "Zero vulnerabilities" (`docs/VISION.md:12`, #7): defined there as zero known High/Critical. One local cargo-audit run found none; no scanner runs in CI, so nothing keeps it true.
- HFT framing: nothing has been measured against a venue. See the definition below.
- Jev latency figures: vendor-reported only (C14).
- "Self-learning model stack" (root `CLAUDE.md` repo map, `docs/VISION.md:13`, `ml/__init__.py`, README in #8): no model, label or validated signal exists; describe `ml/` as the planned model pipeline.
- "CI runs the same recipe" (root CLAUDE.md, justfile skip messages): no CI workflow exists on any pushed branch.

## Deferred scope (not needed for M0)

| Item | Reason |
|---|---|
| RD-Agent / qlib sandbox | Automated factor search multiplies trials before one hand-built baseline exists |
| Decision layer, Jev integration | No call site has a measured need; distillation blocked (C2) |
| L0-L3 learning speeds | Needs a validated signal and labels first |
| Nine autonomy loops | Need merged bootstrap, breakers, App token, second approver |
| Eval suite of 30-100 tasks | Research-loop §7: build from the first workflow's actual failures |
| Plugin marketplace, managed settings | Plans unknown; one repo, two people |
| sops/age encryption | No threat model or recovery plan (C8) |
| 20-metric ratchet | Replaced by invariants plus tolerances (C5) |
| Second-vertical interfaces | No first vertical chosen |

## HFT, defined for this project

HFT here means: a strategy whose edge decays within a horizon short enough that the measured
tick-to-venue-ack latency materially changes its expected value after costs. Claiming it needs
three separate measurements: local processing (feed decode to order out), network round trip to
the venue, and venue acknowledgement time, each as a distribution from recorded runs.

Measured today: nothing about a venue. The #1 criterion bench would measure only in-process
book-apply on synthetic deltas, and it has not been run for numbers. Required before any HFT
claim: a signal-decay curve for a chosen instrument and the three latency distributions above.
Candidate Kalshi work (forecasting, event contracts) is ordinary API automation unless that
evidence says otherwise.

## Selected bottleneck

There is no verified evidence that any edge exists in the candidate market. Infrastructure, agents
and learning loops cannot fix that. The first research cycle (`research/0001-favorite-longshot`,
pre-registered in `a299ba1`) tests one mechanism, favorite-longshot bias on settled Kalshi markets, against a baseline and may end in rejection.
