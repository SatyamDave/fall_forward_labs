# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **162974a 2026-09-28**. Latest CI on `main`: **success on effb75d**.
Paid AI loops: **off**.

## Open pull requests (0)

None.

## Recently merged

| PR | Title | Merged |
|---|---|---|
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
| [#9](https://github.com/SatyamDave/fall_forward_labs/pull/9) | Propose first vertical in ADR-0020 and plan base completion (Phase 0) | 2026-09-28 |
| [#4](https://github.com/SatyamDave/fall_forward_labs/pull/4) | Record decision-layer ADRs and TypeSafe vendor review (Phase 1) | 2026-09-28 |
| [#3](https://github.com/SatyamDave/fall_forward_labs/pull/3) | Add autonomy tier policy and gate check (Phase A) | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `162974a` | 2026-09-28 | docs(status): regenerate live status from 360d053 [skip ci] |
| `360d053` | 2026-09-28 | docs(status): regenerate live status from effb75d [skip ci] |
| `effb75d` | 2026-09-27 | Merge pull request #62 from SatyamDave/docs/record-merge-exception |
| `543468b` | 2026-09-27 | docs(team): record the second merge batch as a dated founder exception |
| `fa7afb9` | 2026-09-28 | docs(status): regenerate live status from 9543372 [skip ci] |
| `9543372` | 2026-09-27 | Merge pull request #56 from SatyamDave/agentic/evals |
| `63f8270` | 2026-09-27 | Merge main into agentic/evals before merging #56 |
| `b825e5a` | 2026-09-28 | docs(status): regenerate live status from 1ed4d2c [skip ci] |
| `1ed4d2c` | 2026-09-27 | Merge pull request #61 from SatyamDave/agentic/agent-service |
| `21ff75e` | 2026-09-28 | docs(status): regenerate live status from 4d26c8e [skip ci] |
| `c32f44f` | 2026-09-27 | Merge main into agentic/agent-service before merging #61 |
| `4d26c8e` | 2026-09-27 | Merge pull request #58 from SatyamDave/agentic/bridge |

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
- Rust #[test] functions: 70
- Python test functions: 134
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1
