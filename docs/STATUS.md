# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **fa22726 2026-09-28**. Latest CI on `main`: **in_progress on fa22726**.
Paid AI loops: **off**.

## Open pull requests (1)

| PR | Title | Author | Draft |
|---|---|---|---|
| [#84](https://github.com/SatyamDave/fall_forward_labs/pull/84) | Wire the gateway to protocol v1.2: reconciliation, cancel, market clock | SatyamDave | no |

## Recently merged

| PR | Title | Merged |
|---|---|---|
| [#83](https://github.com/SatyamDave/fall_forward_labs/pull/83) | Turn real trades into lessons, and only promote agent changes that prove better | 2026-09-28 |
| [#82](https://github.com/SatyamDave/fall_forward_labs/pull/82) | Record real Robinhood price data for our asset | 2026-09-28 |
| [#81](https://github.com/SatyamDave/fall_forward_labs/pull/81) | Measure real per-decision latency (bridge, decide, full loop) | 2026-09-28 |
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

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `fa22726` | 2026-09-28 | Merge pull request #83 from SatyamDave/wave2/learning-loop |
| `4529807` | 2026-09-28 | chore: re-run PR checks after description fix |
| `6f86a03` | 2026-09-28 | Merge main into wave2/learning-loop before merging #83 |
| `2000155` | 2026-09-28 | feat(evals): turn real trades into test scenarios, gate agent changes on proof (#52, #53) |
| `878bdbe` | 2026-09-28 | docs(status): regenerate live status from 90b2ac1 [skip ci] |
| `90b2ac1` | 2026-09-28 | Merge pull request #82 from SatyamDave/wave2/recorder |
| `8788180` | 2026-09-28 | test(agent): close two side doors in the broker-isolation test |
| `2b4752f` | 2026-09-28 | Merge main into wave2/recorder before merging #82 |
| `a6036b7` | 2026-09-28 | feat(agent/recorder): record real Robinhood quotes into the replay-store format (#46) |
| `84a0f7c` | 2026-09-28 | docs(status): regenerate live status from e0580e4 [skip ci] |
| `e0580e4` | 2026-09-28 | Merge pull request #81 from SatyamDave/wave2/latency |
| `f01b48d` | 2026-09-28 | feat(bench): measure real per-decision latency for issues #31/#55 |

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
- Python test functions: 248
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1, `study-0002-favorite-longshot-v2` 1
