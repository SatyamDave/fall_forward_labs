# Live status

Regenerated automatically by `.github/workflows/docs-status.yml` on every merge to
`main`, and every 30 minutes for PR changes. Do not edit by hand; edit
`scripts/docs/gen_status.py`.
Narrative docs: [project guide](guide/quant-core-guide.html) ·
[base status](reports/base-status.md) · [NOW](NOW.md).

Generated from `main` at **a814831 2026-09-27**. Latest CI on `main`: **success on b95c2d9**.
Paid AI loops: **off**.

## Open pull requests (1)

| PR | Title | Author | Draft |
|---|---|---|---|
| [#19](https://github.com/SatyamDave/fall_forward_labs/pull/19) | Add an illustrated project guide and the Robinhood trading path | SatyamDave | no |

## Recently merged

| PR | Title | Merged |
|---|---|---|
| [#18](https://github.com/SatyamDave/fall_forward_labs/pull/18) | build(deps): Bump bridgecrewio/checkov-action from 12.1347.0 to 12.3125.0 in the actions group | 2026-09-28 |
| [#8](https://github.com/SatyamDave/fall_forward_labs/pull/8) | Document the actual base state and consolidate the repo guide | 2026-09-28 |
| [#17](https://github.com/SatyamDave/fall_forward_labs/pull/17) | Fix base integration failures and make checks cover every suite | 2026-09-28 |
| [#6](https://github.com/SatyamDave/fall_forward_labs/pull/6) | Draft team plan and docs/NOW.md for both founders (Phase 1) | 2026-09-28 |
| [#16](https://github.com/SatyamDave/fall_forward_labs/pull/16) | Test favorite-longshot bias on settled Kalshi markets: insufficient evidence, listing cap dropped every day | 2026-09-28 |
| [#9](https://github.com/SatyamDave/fall_forward_labs/pull/9) | Propose first vertical in ADR-0020 and plan base completion (Phase 0) | 2026-09-28 |
| [#4](https://github.com/SatyamDave/fall_forward_labs/pull/4) | Record decision-layer ADRs and TypeSafe vendor review (Phase 1) | 2026-09-28 |
| [#3](https://github.com/SatyamDave/fall_forward_labs/pull/3) | Add autonomy tier policy and gate check (Phase A) | 2026-09-28 |
| [#2](https://github.com/SatyamDave/fall_forward_labs/pull/2) | Record self-learning model plan and ADR-0013 learning speeds (Phase 1) | 2026-09-28 |
| [#15](https://github.com/SatyamDave/fall_forward_labs/pull/15) | Build order book, OMS, risk checks, SimVenue and deterministic replay with kill-switch chaos tests | 2026-09-28 |
| [#13](https://github.com/SatyamDave/fall_forward_labs/pull/13) | Add security pipeline: pre-commit, CI and scanner workflows, hardening script | 2026-09-28 |
| [#12](https://github.com/SatyamDave/fall_forward_labs/pull/12) | Add the ML stack with Python/Rust feature parity and hash-checked model loading | 2026-09-28 |
| [#11](https://github.com/SatyamDave/fall_forward_labs/pull/11) | Add Claude Code settings, guard hooks, rules, agents and skills with hook tests | 2026-09-28 |
| [#10](https://github.com/SatyamDave/fall_forward_labs/pull/10) | Add knowledge loop workflows that propose one scope-checked knowledge PR per merge, week and month | 2026-09-28 |
| [#14](https://github.com/SatyamDave/fall_forward_labs/pull/14) | Audit repo against all prompts and consolidate shared instructions | 2026-09-28 |

## Recent commits on main

| Commit | Date | Subject |
|---|---|---|
| `a814831` | 2026-09-27 | docs: add an illustrated project guide and the Robinhood trading path |
| `b95c2d9` | 2026-09-27 | Merge pull request #18 from SatyamDave/dependabot/github_actions/actions-f1906c3da7 |
| `e086fce` | 2026-09-27 | Merge pull request #8 from SatyamDave/bootstrap/phase-7-contributor |
| `8947f43` | 2026-09-27 | docs: describe main after the 2026-09-28 merges |
| `446e78f` | 2026-09-27 | Merge main (9f39eee) into the docs branch |
| `9f39eee` | 2026-09-27 | Merge pull request #17 from SatyamDave/fix/base-integration |
| `54de479` | 2026-09-28 | build(deps): Bump bridgecrewio/checkov-action in the actions group |
| `c701e89` | 2026-09-27 | Merge main into fix/base-integration before merging #17 |
| `f5b2e22` | 2026-09-27 | Merge pull request #6 from SatyamDave/team/phase-1-now |
| `ccec770` | 2026-09-27 | Merge pull request #16 from SatyamDave/research/0001-favorite-longshot |
| `90845a0` | 2026-09-27 | test(study-0001): build the synthetic fixture without random so no noqa is needed |
| `9df7777` | 2026-09-27 | Merge main into research/0001-favorite-longshot to resolve conflicts before merge |

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

## Code and research

- Engine crates: `core`, `gateway`, `inference`, `oms`, `orderbook`, `replay`, `risk`, `strategy-runtime`, `telemetry`
- Rust #[test] functions: 47
- Python test functions: 108
- Registry trials: `demo` 4, `study-0001-favorite-longshot` 1
