# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **4ee3c9a 2026-09-28**. Latest CI on `main`: **queued on 4ee3c9a**.
Paid AI loops: **off**.

## Open pull requests (0)

None.

## Recently merged

| PR | Title | Merged |
|---|---|---|
| [#78](https://github.com/SatyamDave/fall_forward_labs/pull/78) | Redo study 0001 favorite-longshot v2, bounded population, real sample | 2026-09-28 |
| [#77](https://github.com/SatyamDave/fall_forward_labs/pull/77) | ops: give live trading a safe home and alert on it breaking | 2026-09-28 |
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

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `4ee3c9a` | 2026-09-28 | Merge pull request #78 from SatyamDave/wave1/research |
| `606be22` | 2026-09-28 | Merge main into wave1/research before merging #78 |
| `ac4a150` | 2026-09-28 | fix(research): skip study 0002's real-data recompute when the snapshot is absent |
| `14858f3` | 2026-09-28 | docs(status): regenerate live status from 0fcf59a [skip ci] |
| `8eb4c94` | 2026-09-28 | Merge main into wave1/research before merging #78 |
| `0fcf59a` | 2026-09-28 | Merge pull request #77 from SatyamDave/wave1/ops |
| `314bdbe` | 2026-09-28 | Merge main into wave1/ops before merging #77 |
| `e774b4c` | 2026-09-28 | docs(status): regenerate live status from 836a1ab [skip ci] |
| `836a1ab` | 2026-09-28 | Merge pull request #79 from SatyamDave/wave1/evals-reports |
| `7cfe50c` | 2026-09-28 | Merge main into wave1/evals-reports before merging #79 |
| `8f0edce` | 2026-09-28 | docs(status): regenerate live status from 88064aa [skip ci] |
| `88064aa` | 2026-09-28 | Merge pull request #72 from SatyamDave/wave1/simvenue |

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
- Python test functions: 198
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1, `study-0002-favorite-longshot-v2` 1
