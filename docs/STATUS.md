# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **836a1ab 2026-09-28**. Latest CI on `main`: **in_progress on 836a1ab**.
Paid AI loops: **off**.

## Open pull requests (2)

| PR | Title | Author | Draft |
|---|---|---|---|
| [#78](https://github.com/SatyamDave/fall_forward_labs/pull/78) | Redo study 0001 favorite-longshot v2, bounded population, real sample | SatyamDave | no |
| [#77](https://github.com/SatyamDave/fall_forward_labs/pull/77) | ops: give live trading a safe home and alert on it breaking | SatyamDave | no |

## Recently merged

| PR | Title | Merged |
|---|---|---|
| [#79](https://github.com/SatyamDave/fall_forward_labs/pull/79) | Baseline-checked evals, decision/PnL reports, and a stop rule | 2026-09-28 |
| [#72](https://github.com/SatyamDave/fall_forward_labs/pull/72) | Make SimVenue consume liquidity and respect queue position | 2026-09-28 |
| [#75](https://github.com/SatyamDave/fall_forward_labs/pull/75) | Add self-cross, wash-trade and daily-notional dollar caps to qc-risk | 2026-09-28 |
| [#80](https://github.com/SatyamDave/fall_forward_labs/pull/80) | Replaying a recorded decision gives the same ledger every time | 2026-09-28 |
| [#74](https://github.com/SatyamDave/fall_forward_labs/pull/74) | Prove the agent can only place orders one way, replay decisions for free, write the live prompt | 2026-09-28 |
| [#73](https://github.com/SatyamDave/fall_forward_labs/pull/73) | Build the broker gateway door and a mock Robinhood connection | 2026-09-28 |
| [#76](https://github.com/SatyamDave/fall_forward_labs/pull/76) | Stamp approved orders and prove the bridge refuses what it doesn't understand | 2026-09-28 |
| [#62](https://github.com/SatyamDave/fall_forward_labs/pull/62) | Record the second merge batch as a dated founder exception | 2026-09-28 |
| [#56](https://github.com/SatyamDave/fall_forward_labs/pull/56) | Add the three-tier eval harness (just eval, Tier 1) | 2026-09-28 |
| [#61](https://github.com/SatyamDave/fall_forward_labs/pull/61) | Build the agent service against qc-bridge protocol v1 | 2026-09-28 |
| [#58](https://github.com/SatyamDave/fall_forward_labs/pull/58) | Add qc-bridge: protocol v1 stdio bridge between the engine and the agent | 2026-09-28 |
| [#59](https://github.com/SatyamDave/fall_forward_labs/pull/59) | Record ADR-0040 in every CLAUDE.md and add the arch-check gate | 2026-09-28 |
| [#60](https://github.com/SatyamDave/fall_forward_labs/pull/60) | Record ADR-0040, the agentic decision, across the docs | 2026-09-28 |
| [#19](https://github.com/SatyamDave/fall_forward_labs/pull/19) | Add an illustrated project guide and the Robinhood trading path | 2026-09-28 |
| [#18](https://github.com/SatyamDave/fall_forward_labs/pull/18) | build(deps): Bump bridgecrewio/checkov-action from 12.1347.0 to 12.3125.0 in the actions group | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `836a1ab` | 2026-09-28 | Merge pull request #79 from SatyamDave/wave1/evals-reports |
| `7cfe50c` | 2026-09-28 | Merge main into wave1/evals-reports before merging #79 |
| `8f0edce` | 2026-09-28 | docs(status): regenerate live status from 88064aa [skip ci] |
| `88064aa` | 2026-09-28 | Merge pull request #72 from SatyamDave/wave1/simvenue |
| `1b02f70` | 2026-09-28 | Merge main into wave1/simvenue before merging #72 |
| `81c1f9a` | 2026-09-28 | Merge main into wave1/simvenue before merging #72 |
| `a4456d8` | 2026-09-28 | docs(status): regenerate live status from 6c776c6 [skip ci] |
| `6c776c6` | 2026-09-28 | Merge pull request #75 from SatyamDave/wave1/risk |
| `abbe049` | 2026-09-28 | docs(status): regenerate live status from 1ac55f3 [skip ci] |
| `212b43f` | 2026-09-28 | Merge main into wave1/risk before merging #75 |
| `1ac55f3` | 2026-09-28 | Merge pull request #80 from SatyamDave/fix/replay-ledger-determinism |
| `257b29c` | 2026-09-28 | fix(agent): record wall-clock latency only for live decisions |

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
- Rust #[test] functions: 95
- Python test functions: 165
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1
