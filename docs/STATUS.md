# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **aa603d1 2026-09-28**. Latest CI on `main`: **queued on aa603d1**.
Paid AI loops: **off**.

## Open pull requests (0)

None.

## Recently merged

| PR | Title | Merged |
|---|---|---|
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
| [#75](https://github.com/SatyamDave/fall_forward_labs/pull/75) | Add self-cross, wash-trade and daily-notional dollar caps to qc-risk | 2026-09-28 |
| [#80](https://github.com/SatyamDave/fall_forward_labs/pull/80) | Replaying a recorded decision gives the same ledger every time | 2026-09-28 |
| [#74](https://github.com/SatyamDave/fall_forward_labs/pull/74) | Prove the agent can only place orders one way, replay decisions for free, write the live prompt | 2026-09-28 |
| [#73](https://github.com/SatyamDave/fall_forward_labs/pull/73) | Build the broker gateway door and a mock Robinhood connection | 2026-09-28 |
| [#76](https://github.com/SatyamDave/fall_forward_labs/pull/76) | Stamp approved orders and prove the bridge refuses what it doesn't understand | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `aa603d1` | 2026-09-28 | Merge pull request #86 from SatyamDave/fix/arch-check-headings |
| `fa306e1` | 2026-09-28 | fix(ci): accept PR-template sections written as headings without a colon |
| `e743334` | 2026-09-28 | docs(status): regenerate live status from 13866c8 [skip ci] |
| `13866c8` | 2026-09-28 | Merge pull request #84 from SatyamDave/wave2/gateway-integration |
| `249fc10` | 2026-09-28 | Merge main into wave2/gateway-integration before merging #84 |
| `69ea482` | 2026-09-28 | test(recorder): give the replay-integration test realistic poll timing |
| `b720f0f` | 2026-09-28 | docs(status): regenerate live status from 525399d [skip ci] |
| `6eb4a03` | 2026-09-28 | Merge main into wave2/gateway-integration before merging #84 |
| `525399d` | 2026-09-28 | Merge pull request #85 from SatyamDave/wave2/bridge-control |
| `4714a5c` | 2026-09-28 | chore: re-run PR checks after description fix |
| `9c52c85` | 2026-09-28 | Merge main into wave2/bridge-control before merging #85 |
| `1cfbed8` | 2026-09-28 | feat(agent): run just agent-sim-external against the real qc-bridge binary |

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
- Rust #[test] functions: 128
- Python test functions: 253
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1, `study-0002-favorite-longshot-v2` 1
