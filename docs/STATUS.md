# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **502df0f 2026-09-28**. Latest CI on `main`: **queued on 502df0f**.
Paid AI loops: **off**.

## Open pull requests (5)

| PR | Title | Author | Draft |
|---|---|---|---|
| [#79](https://github.com/SatyamDave/fall_forward_labs/pull/79) | Baseline-checked evals, decision/PnL reports, and a stop rule | SatyamDave | no |
| [#78](https://github.com/SatyamDave/fall_forward_labs/pull/78) | Redo study 0001 favorite-longshot v2, bounded population, real sample | SatyamDave | no |
| [#77](https://github.com/SatyamDave/fall_forward_labs/pull/77) | ops: give live trading a safe home and alert on it breaking | SatyamDave | no |
| [#75](https://github.com/SatyamDave/fall_forward_labs/pull/75) | Add self-cross, wash-trade and daily-notional dollar caps to qc-risk | SatyamDave | no |
| [#72](https://github.com/SatyamDave/fall_forward_labs/pull/72) | Make SimVenue consume liquidity and respect queue position | SatyamDave | no |

## Recently merged

| PR | Title | Merged |
|---|---|---|
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
| [#8](https://github.com/SatyamDave/fall_forward_labs/pull/8) | Document the actual base state and consolidate the repo guide | 2026-09-28 |
| [#17](https://github.com/SatyamDave/fall_forward_labs/pull/17) | Fix base integration failures and make checks cover every suite | 2026-09-28 |
| [#6](https://github.com/SatyamDave/fall_forward_labs/pull/6) | Draft team plan and docs/NOW.md for both founders (Phase 1) | 2026-09-28 |
| [#16](https://github.com/SatyamDave/fall_forward_labs/pull/16) | Test favorite-longshot bias on settled Kalshi markets: insufficient evidence, listing cap dropped every day | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `502df0f` | 2026-09-28 | Merge pull request #74 from SatyamDave/wave1/agent-core |
| `694a8ed` | 2026-09-28 | docs(status): regenerate live status from 153f09e [skip ci] |
| `65478d5` | 2026-09-28 | Merge main into wave1/agent-core before merging #74 |
| `153f09e` | 2026-09-28 | Merge pull request #73 from SatyamDave/wave1/gateway |
| `dd4ee3c` | 2026-09-28 | Merge main into wave1/gateway before merging #73 |
| `6c3a887` | 2026-09-28 | docs(status): regenerate live status from 1f5a183 [skip ci] |
| `1f5a183` | 2026-09-28 | Merge pull request #76 from SatyamDave/wave1/bridge-v11 |
| `5940dd9` | 2026-09-28 | docs(agent): note that an SDK version bump must re-run the permission e2e test |
| `60e8d94` | 2026-09-28 | fix(agent/broker): persist a journal so a restart never blind-resubmits an order |
| `b1fb65c` | 2026-09-28 | style(bridge): cargo fmt the negative-price test |
| `0172d6e` | 2026-09-28 | docs(bridge): name the clock the gateway must use for approval expiry |
| `34cc420` | 2026-09-28 | fix(bridge): refuse a negative fill price/qty in report_execution |

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
- Rust #[test] functions: 86
- Python test functions: 134
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1
