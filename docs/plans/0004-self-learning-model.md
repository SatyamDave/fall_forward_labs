# Plan 0004: Self-learning model

Principle: **learning is continuous, authority is bounded.** Models change what they
predict on their own, never how much they may risk. Structural change goes
challenger, then shadow, then human approval. Getting worse always triggers
automatic demotion.

Design record: [ADR-0013 learning speeds](../adr/0013-learning-speeds.md) defines
L0 (online), L1 (daily retrain), L2 (structural search) and L3 (meta-learning), what
each may change, its bound source, its replay requirement and who may promote or
demote it.

Rules for this plan:
- One phase per branch and PR (`selflearn/phase-N-<name>`), then stop for review.
- Verify every library and API against current docs before using it; record the
  version and license checked.
- Never touch a protected zone without human approval. Never loosen a bound or
  threshold to make a model pass; stop and ask.
- This file is the source of truth for status. Update the table in each phase PR.

## Dependencies (must merge before Phase 2 starts)

| Prerequisite | Why |
|---|---|
| Bootstrap (plan 0001), all phases | Repo skeleton, protected zones and `guard-protected.sh`, `just replay`, experiment and model registry, `ml/` stack, risk crate, `config/limits/` |
| Autonomy Phases A-B (plan 0002) | `autonomy/POLICY.yaml` tiers T0-T3 and `autonomy-gate.yml`; `loop-models` and `loop-discovery`; model circuit breaker |
| Decision layer Phase 6 (plan 0003, ADR-0012) | The calibrated selective signal model, ONNX/codegen export, Rust inference with "no signal" fallback, and parity tests that L1-L3 build on |

Phase 1 (this PR) is docs only and does not wait on them. None of them is merged
at the time of writing, so paths below are the ones those plans specify and may
move; each later phase re-checks them against main.

## Status

| Phase | Deliverable | Status | PR |
|---|---|---|---|
| 1 | ADR-0013 learning speeds + this plan | In review | this PR |
| 2 | L0 online adaptation in the engine | Not started (blocked on dependencies) | |
| 3 | Execution models learned from our own trading | Not started | |
| 4 | L1 continual nightly retrain | Not started | |
| 5 | L2 structural search | Not started | |
| 6 | L3 meta-learning | Not started | |
| 7 | Closed loop: monitoring, demotion, promotion ladder | Not started | |
| 8 | Docs, skills, glossary | Not started | |

## Phases

Tier column: T3 = protected, two humans plus risk-auditor (autonomy Phase A);
T2 = one human.

### Phase 1: ADR-0013 (docs only)

| Path | Tier |
|---|---|
| `docs/adr/0013-learning-speeds.md` | T2 (ADR approval itself is a human decision) |
| `docs/plans/0004-self-learning-model.md` | T2 |

Done when: ADR-0013 is approved by a human.

### Phase 2: L0 online adaptation

Deterministic update rules only (EWMA volatility, exponentially weighted
calibration correction, bounded Kalman-style filters); no online neural-network
updates in the hot path. State is a pure function of logged events, snapshotted to
the event log every N seconds. Every parameter has `min`, `max`,
`max_change_per_minute` and `default`; at a bound it clamps and alerts. Anomaly
(stale data or sequence gap, NaN/inf, pinned at bound longer than T, realized edge
outside band) resets to defaults and alerts.

| Path | Tier |
|---|---|
| `config/limits/adaptation.yaml` (new; includes the L3 online section, initially empty) | **T3 protected** |
| `config/limits/exploration.yaml` (new; `enabled: false`) | **T3 protected** |
| `engine/crates/adapt/` (new crate, own CLAUDE.md listing allowed update rules and "adding a new adaptive parameter requires a bound in config/limits and a human approval") | T2 |
| `engine/Cargo.toml` workspace member | T2 |
| `tests/replay/` replay-equality case, `tests/chaos/` garbage-feed case | T2 |

Tests: property tests that no input escapes bounds; replay equality with the live
snapshot; chaos feeds (NaN, stale, gaps, pinned bound) reset and alert.

### Phase 3: Execution models (`ml/execution/`)

Fill probability given level, estimated queue position, book state and time in
queue; adverse selection (mid move after our fill, per horizon and fill type);
markout (realized-edge distribution per strategy, venue, regime); latency
distribution. Selection-bias controls from ADR-0013: log every quoting decision
including those not taken, with decision-time probabilities; importance weighting
and doubly robust off-policy evaluation; exploration only inside
`exploration.yaml`, default off, own human approval, daily cost cap, every
exploratory order tagged. Outputs calibrate `backtest/fill_models/` and
`backtest/latency_models/`; the monthly backtest-vs-live fill gap is tracked as a
standing backlog item.

| Path | Tier |
|---|---|
| `ml/execution/` | T2 |
| `backtest/fill_models/`, `backtest/latency_models/` calibration inputs | T2 |
| Engine decision logging (quote considered / placed, propensities) in `engine/crates/strategy-runtime/` or `telemetry` | T2 |
| Turning exploration on in `config/limits/exploration.yaml` | **T3 protected**, separate approval |

### Phase 4: L1 continual retrain (`ml/training/continual/`)

Nightly rolling window (length chosen by walk-forward, recorded); warm start from
the champion plus a from-scratch control. Ternary labels net of costs plus an
execution-aware second target. Forgetting controls: replay buffer of past regimes,
especially stress; regime panel (calm, trending, high-vol, liquidation cascades,
low liquidity); a challenger that improves recent data but collapses on stress
fails. Recalibrate on the latest held-out fold with reliability per regime.
Registers a challenger (dataset hash, feature version, config, seed, library
versions, metrics, lineage); promotes nothing.

| Path | Tier |
|---|---|
| `ml/training/continual/` | T2 |
| `loop-models` job wiring (workflow file) | **T3 protected** (`.github/workflows/**`) |

### Phase 5: L2 structural search (`ml/search/`)

Search space: features (library plus RD-Agent/qlib sandbox proposals), label
horizons, abstention thresholds, hyperparameters, model family (linear, GBDT,
small sequence). Optuna or equivalent, seeded, with a fixed weekly trial budget.
Every trial in the registry; cumulative trial count feeds deflated Sharpe and PBO.
Feature lifecycle candidate, validated, production, retired; retirement via T2 PR
to the graveyard with tags. Complexity penalty: beat the simpler champion after
costs by the policy margin and fit the Rust latency budget. Every new production
feature needs a Rust implementation and parity test before shadow.

| Path | Tier |
|---|---|
| `ml/search/` (search space + trial budget config) | T2 |
| `ml/registry/` cumulative trial count | T2 |
| `research/sandbox/` proposal intake | T2 |
| `engine/crates/inference/` feature implementations + parity tests | T2 |
| `docs/research/graveyard.md` retired features | T0 |

### Phase 6: L3 meta-learning (`ml/meta/`)

Regime model (HMM or clustering plus rules over volatility, spread, volume,
funding, cross-venue dispersion) tags periods; metrics are reported per regime.
Meta-labeling: a secondary classifier for "will the primary signal's trade be
profitable after costs in this context", which gates and sizes downward only.
Ensemble: contextual bandit or Bayesian updating over approved models by recent
realized edge per regime; may shift allocation and shrink total exposure, never
above the approved cap. Self-doubt: confidence shrinks toward abstention on
out-of-distribution detection, ensemble disagreement or calibration drift.

| Path | Tier |
|---|---|
| `ml/meta/` | T2 |
| Online weighting in `engine/crates/adapt/` | T2 |
| L3 bounds in `config/limits/adaptation.yaml` | **T3 protected** |

### Phase 7: Closed loop (`loop-models`, `ml/monitoring/`)

Monitors per model: feature drift (PSI/KS), prediction drift, rolling ECE, realized
vs expected edge, markout decay, abstention rate, regime mix. Always-allowed
actions: soft degrade (raise abstention threshold, shrink meta-label size), hard
demote (no signal, roll back to previous champion if healthy), and record to the
registry plus a needs-human issue with a diagnostic dossier. Promotion ladder,
never automatic: validation, regime panel and trial-adjusted gates; shadow for at
least N days or events against the champion; promotion dossier; human T3; canary
on a small fraction with automatic rollback; full allocation within the existing
budget. Every demotion, failed shadow and canary rollback produces a registry
record, a graveyard or journal entry and an eval case; repeated patterns go to
`ml/CLAUDE.md` Learned and the search-space config through knowledge PRs.

| Path | Tier |
|---|---|
| `ml/monitoring/` | T2 |
| `loop-models` workflow changes | **T3 protected** |
| Promotion past shadow, canary, scaled | **T3** (human decision per model) |
| `docs/reports/weekly/` model section | T0 |

### Phase 8: Docs

`ml/CLAUDE.md` (four speeds and what each may change; demotion automatic,
promotion human; trial accounting mandatory; regime panel required; online bounds
in protected config). `engine/crates/adapt/CLAUDE.md`. Skills:
`diagnose-model-decay`, `add-feature`, `regime-panel-report`,
`exploration-proposal`. Glossary: online learning, catastrophic forgetting, replay
buffer, meta-labeling, regime, contextual bandit, off-policy evaluation, markout,
adverse selection, PSI, ECE. `docs/onboarding/how-this-repo-learns.md` section "How
the model learns" with an L0-L3 diagram and the demotion and promotion paths.

| Path | Tier |
|---|---|
| `ml/CLAUDE.md`, `engine/crates/adapt/CLAUDE.md` | T2 (CLAUDE.md edits outside knowledge PRs need a human) |
| `ml/.claude/skills/`, `.claude/skills/` | T2 (new skills) |
| `docs/GLOSSARY.md`, `docs/onboarding/how-this-repo-learns.md` | T0/T2 |

## Acceptance checklist

| # | Check | Phase |
|---|---|---|
| 1 | ADR-0013 approved by a human | 1 |
| 2 | `adaptation.yaml` and `exploration.yaml` exist, are protected (guard hook blocks edits, CODEOWNERS two approvals), exploration is off | 2 |
| 3 | Property tests: no input moves an L0 parameter outside its bounds | 2 |
| 4 | Replay reproduces adapted state bit-for-bit | 2 |
| 5 | NaN, stale-data and pinned-bound inputs reset to defaults and alert (tests) | 2 |
| 6 | Fill-probability and adverse-selection models train from sample logs with off-policy evaluation | 3 |
| 7 | Nightly retrain registers a challenger with a regime panel; a challenger that fails stress regimes is rejected (test) | 4 |
| 8 | Every search trial is in the registry, and deflated Sharpe uses the cumulative count (test) | 5 |
| 9 | Meta-label and bandit output cannot exceed the approved cap (property test) | 6 |
| 10 | Injected drift causes soft degrade, then hard demote, then rollback, then a needs-human issue (test) | 7 |
| 11 | Promotion without human approval is blocked at every step (test) | 7 |
| 12 | Weekly report shows champion age, challenger win rate, demotions, backtest-vs-live fill gap and trial counts | 7 |
| 13 | ml and adapt CLAUDE.md, four skills, glossary terms and the how-this-repo-learns section exist | 8 |

## Do not

- No level modifies risk limits, position caps, exploration budgets or the kill
  switch.
- No online update that cannot be replayed.
- No automatic promotion past shadow.
- No hidden trials.
- No training on live execution labels before Phase 3's selection-bias controls.
- Never loosen a bound or threshold to make a model pass; stop and ask.
- No performance claims or return targets in any document.

## Open decisions for a human

1. Approve ADR-0013, including the split of bound sources: L0, L3 online weights
   and exploration in protected `config/limits/`; L1/L2 search space and trial
   budget in T2 `ml/search/` config.
2. Whether entering shadow may be automatic once validation gates pass (this plan
   assumes yes, since shadow places no orders), or needs a human too.
3. The numeric values that belong in the protected files (per-parameter bounds,
   rates, snapshot interval N, pinned-bound time T, edge band, exploration cost cap)
   are for humans to set in Phase 2; agents will propose only conservative
   placeholders.
4. hmmlearn is in limited-maintenance mode; accept it for the regime model or use
   scikit-learn mixtures plus rules instead.
5. Shadow minimum length N (days or events) and the canary fraction for Phase 7.
