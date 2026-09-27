# Plan 0005: quant-core base complete

This plan is the source of truth for finishing the quant-core base. It does not add features. It audits what the four earlier prompts (bootstrap, autonomy, decision layer, self-learning) produced, consolidates them into one architecture, cuts scope to a general core plus one vertical, and makes the repository ready for contributors. A new session should be able to resume from this file alone.

## Scope rule

"General interfaces, one implementation. New verticals require an ADR, a human decision, and a live track record in the current vertical."

The core must support any market family (order-book markets, event contracts, later others), but only one vertical is built end to end until it has a live, reconciled track record. Everything else is an interface, an ADR and a roadmap entry. Half-built components for verticals that are not selected are removed from the build and listed under `parked/` in `docs/ROADMAP.md`, one PR per removal with its reason; history is kept.

## Operating rules

- One phase per PR, then stop for human approval. Agents never push to `main`, never force-push and never merge.
- Verify every external API and tool against its current official docs; record contradictions here.
- Protected zones (root rule 3) change only with human approval.
- No second vertical, family or adapter. No performance claims, return targets or comparisons to other firms. No production venue credentials: demo and paper only. No LLM or Jev forecasts on historical data.

## Status

| Phase | Deliverable | Branch / PR | Status |
|---|---|---|---|
| 0 | `docs/adr/0020-first-vertical.md` (Proposed) and this plan | `base/phase-0-vertical-adr` | Draft PR open; waiting on the human's vertical decision |
| 0 | `docs/audits/0001-base-audit.md` | not started | Pending: waits for the wave-2 PRs (below) |
| 1 | Consolidated `docs/ARCHITECTURE.md`, ADR-0021 slow signals, vertical skeleton | not started | Blocked on Phase 0 approval |
| 2 | Cheap parallel agents: `docs/runbooks/agent-costs.md`, `agents/orchestrator/` | not started | Blocked on Phase 1 |
| 3 | Final CLAUDE.md, skills and rules pass | not started | Blocked on Phase 2 |
| 4 | README and contributor kit | not started | Blocked on Phase 3 |
| 5 | Base-complete checklist | not started | Blocked on Phase 4 |
| 6 | `v0.1.0-base` tag and `docs/reports/base-complete.md` | not started | Blocked on Phase 5 and human approval |

## Phase 0: audit and scope decision

**ADR-0020, first vertical.** Compares kalshi-events, Kalshi perps, crypto perps on Coinbase Derivatives Exchange, and CME futures via a broker on legal access, data availability, capacity, competition, stack fit and time to first live trade. It proposes kalshi-events, conditional on the human confirming jurisdiction, and lists every unverified fact as a question.

**Conflict the human must resolve.** The bootstrap spec (§1) sets liquid crypto perps plus spot as the initial arena. ADR-0003 (venue selection, Proposed, PR #5) works inside that arena and selects no venue until jurisdiction is confirmed; for US persons its shortlist is Coinbase Derivatives, Kraken Derivatives US and CME crypto futures through an FCM, and it does not consider event contracts. This plan's default is kalshi-events. The human picks one:

- If kalshi-events: ADR-0020 is Accepted and supersedes the arena part of ADR-0003 (Context and shortlist; its eligibility research and selection criteria still apply to any later venue) and of `docs/VISION.md`. Both get a "partly superseded by ADR-0020" note; neither is deleted.
- If crypto perps: ADR-0020 is marked Deprecated, ADR-0003 governs, the human picks a venue from its shortlist once jurisdiction is known, and Phases 1 to 5 use the orderbook family and that venue's NautilusTrader adapter (ADR-0001) in place of the Kalshi paths named below.

**Audit, pending.** `docs/audits/0001-base-audit.md` maps every major item from the four prompts to done (exists and tested), partial (what is missing), not started, cut (with reason) or defer (to roadmap, with reason). It flags duplication, components with no tests, CLAUDE.md files over budget, workflows that never ran, and secret-handling gaps. It cannot be written yet: the bootstrap, autonomy, decision-layer and self-learning PRs are still being built by parallel agents (open at the time of writing: #1 skeleton, #2 self-learning Phase 1, #3 autonomy Phase A, with more incoming). Another agent writes the audit after those land, as its own PR.

**Stop.** The human approves ADR-0020 (or picks the alternative) before Phase 1 starts.

## Phase 1: consolidated architecture

- `docs/ARCHITECTURE.md` becomes the single source of truth, with one Mermaid diagram per layer and an overview: 6 governance, 5 control plane, 4 learning, 3 strategies, 2 market families, 1 core.
- Core contracts, each implemented once with no vertical code in core: Instrument, MarketFamily, VenueAdapter, Strategy, SignalSource, RiskCheck, Learner.
- ADR-0021, slow signals: signed, timestamped, versioned forecast records; staleness and max-influence bounds in `config/limits/` (protected); invalid, stale or unsigned means no signal. LLM and Jev forecasts are valid only in forward shadow evaluation, never in historical backtests, and the registry flags block them.
- The selected vertical only. For kalshi-events: `engine/crates/gateway/kalshi/` generated from the pinned OpenAPI and AsyncAPI files with their hashes; `families/event/` (contract model, settlement and resolution rules, binary-book fill model, calibration labels, resolution-source metadata); strategy stubs for disciplined market making and forecast-driven taking; event risk checks in `engine/crates/risk/` (protected).

Verify: `just check`, replay determinism on recorded demo data, adapter tests against demo only.

## Phase 2: cheap parallel agents

Model tiering in POLICY.yaml chosen by evals; prompt caching, batch API, isolated sparse-checkout worktrees, per-loop turn and dollar caps, each verified against current Anthropic docs. Orchestrator runs N workers from a queue with concurrency capped by budget. Weekly metrics: cost per merged PR per loop per tier, eval pass rate per tier.

## Phase 3: CLAUDE.md, skills and rules

Root CLAUDE.md within 150 lines, nested within 80. Add the layer diagram, the scope rule verbatim, and the slow-signal and leakage rules. Consolidate duplicate skills; add `add-market-family` (interface only until approved), `add-vertical` (refuses without an approved ADR) and `first-contribution`. Record `/context` output from five directories in the audit.

## Phase 4: README and contributor kit

README of at most 250 lines with no performance claims; quickstart that works on a fresh clone. Contributor kit: onboarding docs, `docs/ROADMAP.md` (Now, Next, Later flagged "requires lawyers", Parked), 10 to 15 real good-first-issue issues, final CODEOWNERS, complete GLOSSARY.

## Phase 5: base-complete checklist

The checklist in the base-complete spec, Phase 5, each item with evidence (command run, test name or PR link). Nothing is marked done on source inspection alone.

## Phase 6: tag

After the checklist passes and a human approves: `v0.1.0-base` with SBOM and audit, `docs/reports/base-complete.md`, and loop-backlog priorities moved to the vertical roadmap.

## Decisions needing a human

1. The operators' jurisdiction (country, and state if in the US) and the legal entity that will trade.
2. First vertical: kalshi-events (ADR-0020) or the crypto-perps arena (ADR-0003).
3. Weighting of the ADR-0020 criteria, if the unweighted tie between candidates should be broken differently.
4. Whether the entity is eligible under Kalshi's Member Agreement and API terms (or the chosen venue's equivalent).
