# Plan 0003: Decision layer

This plan is the source of truth for the decision layer. It covers seven phases. Each phase is one branch and one PR, and work stops after each PR for human review. The architecture is in [ADR-0010](../adr/0010-decision-layer.md), the vendor review in [ADR-0011](../adr/0011-typesafe-vendor-review.md), and the data rules in [docs/security/data-classes.md](../security/data-classes.md).

## Summary of the design

- Jev and every other hosted decision API are used in the control plane only, never in `engine/`, `strategies/`, live services or any process with venue credentials.
- Every call goes through a provider interface with deterministic rules, a local model, Jev and a small Claude model as interchangeable providers. The order and thresholds for each call site come from our own evaluations.
- Low confidence escalates or abstains to a human. A failure falls through to the next provider. Nothing is fabricated.
- The trading signal model follows the same selective, calibrated idea but is built in-house and runs as deterministic Rust (ADR-0012, Phase 6).

## Findings from Phase 1 that change later phases

- TypeSafe and Jev exist and the API is documented. The primitives are Choice, Score and Noul. A Noul answer has no `confidence` field; its probability is the only output (ADR-0011).
- A versioned model ID exists (`jev-1.13.0`). The official Python SDK defaults to `jev-latest`, so Phase 2 must always pass `model` explicitly and check the response `model` field.
- Vercel AI Gateway, OpenRouter and Cloudflare expose only unversioned Jev IDs that we could find, so they are not approved for production. The official API and a LiteLLM pass-through are.
- The TypeSafe Master Customer Agreement §2.3(b) forbids using Output to "perform model distillation, train a model to imitate the output of the Services". **Phase 5 is blocked until a human with legal authority reviews this.**
- No latency figure, SLA, retention period or deprecation policy is published. These are listed as questions in ADR-0011.

## Status

| Phase | Scope | Branch | Status | Depends on |
|---|---|---|---|---|
| 1 | Vendor verification and data policy (docs only): ADR-0010, ADR-0011, data classes, this plan | `decision/phase-1-vendor-review` | In review (draft PR) | None |
| 2 | `platform/decide/` package: types, provider interface, providers, router, scrubber, ledger, call-site registry, config, import guard | `decision/phase-2-package` | Not started | Phase 1 approved; bootstrap merged; autonomy Phases A and B merged; ADR-0011 questions 1 to 4 answered or accepted as open |
| 3 | Control-plane call sites with golden sets | `decision/phase-3-callsites` | Not started | Phase 2 merged |
| 4 | Head-to-head evaluations; thresholds and provider order into config | `decision/phase-4-evals` | Not started | Phase 3 merged |
| 5 | Local replacement models for call sites | `decision/phase-5-distill` | Blocked | Phase 4 merged; legal answer on MCA §2.3(b) recorded in ADR-0011 |
| 6 | In-house signal model: ADR-0012, `ml/`, `engine/crates/inference/` | `decision/phase-6-signal-model` | Not started | Bootstrap merged (engine, ml, registry); ADR-0012 approved. Independent of Phases 2 to 5 |
| 7 | Docs: CLAUDE.md files, skills, glossary, onboarding | `decision/phase-7-docs` | Not started | Phases 2 to 4 merged; Phase 6 for the engine and ml sections |

ADR numbers: this lane uses 0010, 0011 and 0012. Numbers 0006 (autonomy scheduling) and 0013 (learning speeds) belong to other lanes.

## Phase 1: vendor verification and data policy (docs only)

Deliverables: `docs/adr/0010-decision-layer.md`, `docs/adr/0011-typesafe-vendor-review.md`, `docs/security/data-classes.md`, this plan.

Done when: every vendor claim in ADR-0011 cites a URL or is marked UNVERIFIED and listed as a question; a human approves ADR-0010 and ADR-0011.

## Phase 2: `platform/decide/` package

Python package with its own CLAUDE.md. Before writing any client code, re-read the current TypeSafe API reference and SDK changelog, because the SDK changed its serialization library and a request field shape in its first two weeks. Never invent request fields, SDK methods or model IDs.

- `types.py`: Choice, Score, YesNo question types and a `Decision` record (label, probabilities, confidence, provider, model version, latency, cost). YesNo maps to TypeSafe's Noul, which has no confidence field, so confidence for YesNo is derived by the router from the probability and documented.
- `providers/base.py`: the `DecisionProvider` protocol.
- `providers/jev.py`: official SDK or HTTPS, explicit pinned model, timeouts, retries with jitter, a circuit breaker, and a mismatch check on the response `model`.
- `providers/llm.py`: small Claude model with strict structured output.
- `providers/local.py`: local model with no network access.
- `providers/rules.py`: deterministic rules, preferred when sufficient.
- `router.py`: per-call-site provider order and thresholds from config. Above the high threshold the decision acts; between thresholds it escalates to the next provider or a human queue; below the low threshold it abstains.
- `scrubber.py`: secret-pattern removal, then per-call-site field allowlist, failing closed.
- `ledger.py`: append-only Parquet with input hash, scrubbed input, outputs, provider and pinned version.
- `callsites.py`: named registry; an unknown call site is an error.
- `config/decide.yaml`: policy-protected.
- Budgets: daily caps per call site from `autonomy/POLICY.yaml`; over the cap, the router uses local or rules providers only.
- Security: `TYPESAFE_API_KEY` from the secret manager on control-plane runners only; the TypeSafe host is added to those runners' network allowlist only.
- Guard: `platform/decide` cannot be imported from `engine/`, `strategies/` or live services, enforced by import-lint in CI and a test.

Done when: tests show the import guard fails, the scrubber blocks a seeded API key, strategy parameter file and PnL record, timeouts and all-provider failure end in abstention, and a pin mismatch is treated as a failure.

## Phase 3: call sites (control plane only)

| Call site | Type | Owner | Behavior |
|---|---|---|---|
| `swarm.route_task` | Choice | agents/orchestrator | Low confidence goes to the architect agent |
| `pr.tier_hint` | Choice | autonomy gate | Advisory only; the deterministic gate is authoritative; disagreement adds a `tier-mismatch` label |
| `learnings.triage` | Choice x2 | loop-knowledge | Novel, duplicate or noise, plus target file; high-confidence noise is archived, everything else becomes a PR |
| `ci.failure_class` | Choice | loop-health | Flaky, infra, regression, dependency or test bug |
| `backlog.duplicate` | YesNo | loop-backlog | Dedupe above the threshold |
| `backlog.value` | Score | loop-backlog | One ranking input only |
| `research.paper_relevance` | Score | loop-discovery | Pre-filter only |
| `alert.triage` | Choice | ops/monitoring | Now, later or noise; never suppresses risk or kill-switch alerts |
| `injection.check` | YesNo | every external-ingest loop | Quarantine above a low threshold; one layer of injection defense, not the only one |

Each call site ships with a golden labeled set of at least 200 real examples from repository history in `platform/decide/evals/<callsite>/`, with a labeling definition and the labeler's name, and with its data-class proof.

Out of scope: orders, positions, sizing, risk limits, model promotion, strategy gate passage and fund reporting.

Done when: tests show `pr.tier_hint` cannot change the gate verdict and `alert.triage` cannot suppress a risk or kill-switch alert.

## Phase 4: evaluations

For each call site, compare pinned Jev, the small Claude fallback, rules, and later the local model. Report accuracy, expected calibration error with a reliability diagram, selective accuracy against coverage, latency p50 and p95, cost per 1,000 calls, and failure and timeout rate. Provider order and thresholds go into `config/decide.yaml` with a link to the report. Vendor numbers do not count. Re-run monthly, on every pin bump, and when live disagreement drifts. Entry point `just decide-evals`, plus a weekly CI run.

## Phase 5: local replacement models (blocked)

Blocked on the legal question in ADR-0011. The original design joins ledger decisions with outcomes (human override, revert, routed agent success, whether a CI fix held) and trains a calibrated local model (embeddings plus logistic regression, or a small fine-tuned encoder). MCA §2.3(b) forbids training a model to imitate TypeSafe's output. Until legal review says otherwise, any local model is trained only on our own outcome labels, and the question of whether inputs first routed by Jev are usable is part of that review. The replacement gate is unchanged: the local model must match or beat the incumbent on the evaluation, with calibration no worse and safety call sites unaffected, before a T2 PR moves it ahead in the provider order.

## Phase 6: in-house signal model

ADR-0012 plus `ml/` and `engine/crates/inference/`. A ternary label (up, flat, down) per horizon, where flat means a move smaller than spread plus fees plus expected slippage. Baselines are regularized logistic regression, then gradient-boosted trees. Calibration is isotonic or Platt on a held-out walk-forward fold. Output is a direction only above a calibrated confidence threshold chosen by net expected value after costs. Validation uses purged, embargoed walk-forward folds, deflated Sharpe with the true trial count, and PBO. Inference is exported to Rust with a hash-checked load, Python and Rust parity within tolerance, a criterion latency bench, and "no signal" for missing, stale, NaN or out-of-distribution input. The risk crate checks every order regardless. This phase uses no hosted API.

## Phase 7: docs

`platform/decide/CLAUDE.md` (sendable data classes, no trading call sites, how to add a call site, pinned providers). Root CLAUDE.md gains `platform/` in the repo map and the line "Jev and other hosted decision APIs: control plane only; never engine, strategies, or live services." `engine/` and `ml/` CLAUDE.md gain the selective-classifier contract. Skills: `add-decision-callsite`, `run-decide-evals`, `distill-callsite` (the last one only if Phase 5 is unblocked). Glossary entries for System One model, calibration, ECE, selective classification, abstention, coverage, conformal prediction and distillation. A decision-layer section in `docs/onboarding/how-this-repo-learns.md`.

## Decisions needing a human

1. Approve or amend ADR-0010 and ADR-0011.
2. Answer ADR-0011 questions 1 to 4 (distillation clause, self-serve versus enterprise and ZDR, US-only hosting, liability cap).
3. Decide who contacts TypeSafe with the vendor questions (ADR-0011 questions 5 to 13).
