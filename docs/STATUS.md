# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **ebb8db5 2026-09-28**. Latest CI on `main`: **in_progress on ebb8db5**.
Paid AI loops: **off**.

## Open pull requests (2)

| PR | Title | Author | Draft |
|---|---|---|---|
| [#92](https://github.com/SatyamDave/fall_forward_labs/pull/92) | Profit is measured from what the broker actually filled, checked every day | SatyamDave | no |
| [#91](https://github.com/SatyamDave/fall_forward_labs/pull/91) | Live trading refuses to start until every go-live check passes | SatyamDave | no |

## Recently merged

| PR | Title | Merged |
|---|---|---|
| [#93](https://github.com/SatyamDave/fall_forward_labs/pull/93) | Keep the sample SPY limits inside the canary caps | 2026-09-28 |
| [#90](https://github.com/SatyamDave/fall_forward_labs/pull/90) | Never send an order when the market is closed | 2026-09-28 |
| [#89](https://github.com/SatyamDave/fall_forward_labs/pull/89) | Record the full order book, not just the best price | 2026-09-28 |
| [#88](https://github.com/SatyamDave/fall_forward_labs/pull/88) | Bring the docs and roadmap up to date with what's built | 2026-09-28 |
| [#87](https://github.com/SatyamDave/fall_forward_labs/pull/87) | The kill switch cancels everything at the broker, even if the agent is stuck | 2026-09-28 |
| [#86](https://github.com/SatyamDave/fall_forward_labs/pull/86) | The PR checklist check accepts sections written as headings | 2026-09-28 |
| [#84](https://github.com/SatyamDave/fall_forward_labs/pull/84) | Wire the gateway to protocol v1.2: reconciliation, cancel, market clock | 2026-09-28 |
| [#85](https://github.com/SatyamDave/fall_forward_labs/pull/85) | External kill switch, real instrument, and protocol v1.2 for qc-bridge | 2026-09-28 |
| [#83](https://github.com/SatyamDave/fall_forward_labs/pull/83) | Turn real trades into lessons, and only promote agent changes that prove better | 2026-09-28 |
| [#82](https://github.com/SatyamDave/fall_forward_labs/pull/82) | Record real Robinhood price data for our asset | 2026-09-28 |
| [#81](https://github.com/SatyamDave/fall_forward_labs/pull/81) | Measure real per-decision latency (bridge, decide, full loop) | 2026-09-28 |
| [#78](https://github.com/SatyamDave/fall_forward_labs/pull/78) | Redo study 0001 favorite-longshot v2, bounded population, real sample | 2026-09-28 |
| [#77](https://github.com/SatyamDave/fall_forward_labs/pull/77) | ops: give live trading a safe home and alert on it breaking | 2026-09-28 |
| [#79](https://github.com/SatyamDave/fall_forward_labs/pull/79) | Baseline-checked evals, decision/PnL reports, and a stop rule | 2026-09-28 |
| [#72](https://github.com/SatyamDave/fall_forward_labs/pull/72) | Make SimVenue consume liquidity and respect queue position | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `ebb8db5` | 2026-09-28 | Merge pull request #93 from SatyamDave/fix/spy-limits-within-canary |
| `7d46c30` | 2026-09-28 | Merge main into fix/spy-limits-within-canary before merging #93 |
| `b0b8df7` | 2026-09-28 | fix(limits): keep the sample SPY limits inside the canary caps |
| `44bdf96` | 2026-09-28 | docs(status): regenerate live status from b44607a [skip ci] |
| `b44607a` | 2026-09-28 | Merge pull request #90 from SatyamDave/wave3/calendar |
| `130a5f5` | 2026-09-28 | Merge main into wave3/calendar before merging #90 |
| `0cb401b` | 2026-09-28 | docs(status): regenerate live status from d7d8254 [skip ci] |
| `d7d8254` | 2026-09-28 | Merge pull request #89 from SatyamDave/wave3/level2 |
| `40ecd57` | 2026-09-28 | docs(status): regenerate live status from e564b3d [skip ci] |
| `4390f58` | 2026-09-28 | Merge main into wave3/level2 before merging #89 |
| `b40f7fe` | 2026-09-28 | feat(engine/bridge): add NYSE holiday and early-close calendar to the trading-hours gate |
| `25e0a71` | 2026-09-28 | Record the full order book, not just the best price |

## Decisions (ADRs)

| ADR | Title | Status |
|---|---|---|
| [0001-engine-foundation.md](adr/0001-engine-foundation.md) | ADR-0001: Engine foundation | Proposed |
| [0002-dependencies-and-licenses.md](adr/0002-dependencies-and-licenses.md) | ADR-0002: Dependencies and licenses | Proposed |
| [0003-venue-selection.md](adr/0003-venue-selection.md) | ADR-0003: Venue selection | Proposed |
| [0004-languages-and-toolchain.md](adr/0004-languages-and-toolchain.md) | ADR-0004: Languages and toolchain | Proposed |
| [0005-data-storage.md](adr/0005-data-storage.md) | ADR-0005: Data storage | Proposed |
| [0006-autonomy-scheduling.md](adr/0006-autonomy-scheduling.md) | ADR-0006: Run autonomy loops on GitHub Actions schedules with claude-code-action | unknown |
| [0010-decision-layer.md](adr/0010-decision-layer.md) | ADR-0010: Decision layer (hosted decision models in the control plane only) | Proposed |
| [0011-typesafe-vendor-review.md](adr/0011-typesafe-vendor-review.md) | ADR-0011: TypeSafe AI (Jev) vendor review and access rules | Proposed |
| [0013-learning-speeds.md](adr/0013-learning-speeds.md) | ADR-0013: Learning speeds (L0-L3) and their authority | Proposed (2026-09-27) |
| [0020-first-vertical.md](adr/0020-first-vertical.md) | ADR-0020: First vertical | Proposed |
| [0040-agentic-decision.md](adr/0040-agentic-decision.md) | ADR-0040: Agentic trading decision (final trade call moves to an AI agent) | Accepted by Satyam 2026-09-28 |

## Code and research

- Engine crates: `bridge`, `core`, `gateway`, `inference`, `oms`, `orderbook`, `replay`, `risk`, `strategy-runtime`, `telemetry`
- Rust #[test] functions: 144
- Python test functions: 253
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1, `study-0002-favorite-longshot-v2` 1
