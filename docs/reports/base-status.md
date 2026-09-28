# Base status report (2026-09-27)

What exists, what was verified, what is unresolved, and the two verdicts for this snapshot. This
is not a "base complete" report; the base is not complete.

- **Audited revision:** `0cf6c2c` (#8 head). The chain is `main` `4975ec3` ←
  `integration/base-candidate-2026-09-27` `f1293e3` (every PR #1-#16 head merged with `--no-ff`,
  including #6 after it dropped its NOW.md) ← `fix/base-integration` `17e5abd` (#17) ← #8 docs.
  All 17 PR heads are ancestors of `0cf6c2c`. #8's diff over #17 is Markdown only.
- **main:** `4975ec3` (`chore: initial commit`, one README). No PR is merged. Nothing below is on
  `main`, and nothing has been reviewed.
- **Evidence source:** an independent verifier ran every command below in a fresh clone of
  `0cf6c2c` and captured each exit code directly with `pipefail` set. Its report and logs are kept
  outside the repository; the tables here are imported from it. Inventory by component:
  [docs/audits/0001-reality-audit.md](../audits/0001-reality-audit.md).
- **Environment:** macOS 27.2 arm64; rustc/cargo 1.97.1 from Homebrew with no rustup (so
  `engine/rust-toolchain.toml` is not honoured); uv 0.11.28 (venv CPython 3.12.13); just 1.58.0;
  cargo-deny, cargo-audit, pip-audit and trivy 0.74.0 installed; docker not installed.

## Verdicts

**Documentation: complete for snapshot `0cf6c2c`.** README, NOW, ARCHITECTURE, ROADMAP, TEAM,
CONTRIBUTING, onboarding, runbooks, glossary, specs index and this report describe that revision.
They go stale as soon as a PR merges or a new commit lands.

**Engineering foundation: partially ready.** Met at `0cf6c2c`: setup and `just check` exit 0 with
every suite executed, offline and without credentials; CI passes every job that ran; `just replay`
is a genuine offline end-to-end fixture demo and is deterministic; interfaces, limits and open
work are written down. Unmet:

1. Nothing is on `main`. The 17 PRs need human review and merge in the sequence below.
2. Review cannot be enforced by the platform on this plan: branch protection and rulesets return
   HTTP 403, there is one collaborator, and authors cannot approve their own PRs.
3. The devcontainer has never been built (no docker); only a static trivy scan ran.
4. Study 0001 reproduces only from a snapshot kept outside git on one founder's machine; a clean
   clone cannot reproduce it until an approved shared store exists and Kalshi's data terms are
   checked (UNVERIFIED).
5. Three prepared changes to protected files are unapplied ([docs/proposals/](../proposals/README.md)):
   the Rust toolchain pin, AI-workflow gating, and the CODEOWNERS order. Until 0002 is applied, the
   four paid workflows are ungated once a key exists (none exists today).
6. Every ADR is Proposed; GATES.md thresholds are unapproved and the deflated-Sharpe gate is
   mis-scaled. The first vertical is PENDING.

Not blockers for the offline foundation, and each a separate milestone: venue eligibility and
jurisdiction, real market data, execution calibration, forward validation, live deployment.

## Commands

All at `0cf6c2c`.

| Command | Exit | Result | Limitation |
|---|---|---|---|
| `just setup` | 0 | `cargo fetch`, `uv sync --locked` | Warm caches: no cold-install time measured this pass (an earlier cold run on the candidate took 6 s) |
| `just check` | **0** | 21 s; fmt, clippy `-D warnings`, ruff, mypy, all test suites (table below), audits | |
| `just audit` | 0 | cargo-deny ok; cargo-audit 0 vulnerabilities in 126 crates; pip-audit none | Advisory databases as of 2026-09-27 |
| `CI=true just audit` without pip-audit | 1 | `SKIPPED (not a pass)`, recipe fails | Intended: fails closed in CI. Locally a missing tool is a warning and still exits 0 |
| `just replay` twice | 0, 0 | `d3400a1ab2c32bb4177aa94ab96eef25d53a40a74a62028d46ad5f614b88b8e0` every run | Synthetic fixture; compares two runs, no committed golden hash |
| `just walkforward demo` twice | 0, 0 | Verdict FAIL; writes only gitignored `out/walkforward/demo/`; tree clean; ledger 5 trials / 1 model before and after | Exits 0 on FAIL; only `--record` writes the committed report and registry |
| `just study-0001`, no snapshot | 2 | "snapshot missing", UNREPRODUCIBLE-FROM-CLEAN-CLONE, 17 catalogued sha256 | Intended refusal |
| `just study-0001`, preserved snapshot | 0, 0 | snapshot sha256 verified; `results.json` sha256 `115aca0714e28b902650fe4d884f6d9b9614f5a179855fb5fe8054f8cc92e0a8` both runs, matching the committed file | Snapshot is outside git on one founder's machine |
| `just backtest demo` | 2 | "not implemented" on stderr | Placeholder, now non-zero |
| `just paper demo` | 1 | refuses: no venue connections | Intended |
| `cargo bench ... --no-run` | 0 | both bench binaries build | No timings measured |
| `uvx bandit==1.9.4` (as in `ci.yml`) | 0 | no issues | |
| `git apply --check` on each `docs/proposals/*.patch` | 0 | all three apply | Not applied |
| `trivy config .devcontainer` | 0 | 0 HIGH/CRITICAL; one LOW (DS-0026, no HEALTHCHECK); runs as non-root `vscode` | Build NOT RUN |
| Relative-link check, all tracked Markdown | 0 | 92 links, 0 broken | |
| mermaid-cli, README and ARCHITECTURE | 0, 0 | both render | |

### Test discovery (`just check` → `just test`)

| Suite | Result |
|---|---|
| Rust `cargo test --workspace` | 42 passed |
| research, ml, data (`research/` pytest testpaths) | 22 passed |
| hooks `tests/hooks` | 30 passed |
| knowledge `tests/knowledge` | 10 passed |
| autonomy `tests/autonomy` | 23 passed |
| AI gate `tests/ci` | 15 passed |
| study 0001 tests | 13 passed, 1 skipped by design (no primary metric to recompute when zero markets were analysable; the synthetic-fixture recompute runs) |

### CI

On #17 (`17e5abd`) and #8 (`0cf6c2c`), both drafts: rust, python, miri, just-check, semgrep,
osv-scanner, checkov and trivy pass. `gate` (autonomy-gate) fails by design: paths outside its
rules default to T2, which needs a human approval that does not exist yet (for #8 the path is
`engine/crates/strategy-runtime/CLAUDE.md`). Skipped: codeql (`vars.CODE_SCANNING` unset), sbom
(release only), code-review and security-review (draft PRs), scope-check (no `knowledge` label).
No AI review has made an API call; no `ANTHROPIC_API_KEY` exists.

## Merge sequence

Derived from `git log --first-parent origin/integration/base-candidate-2026-09-27`, the order the
candidate merged cleanly. For human review; nothing here was merged.

1. #5 → #1 → #7 → #14 → #10 → #11 → #12 → #13 → #15 → #2 → #3 → #4 → #9 → #16 → #6. (The
   candidate also merged #8's earlier head fifth and #16's registration commit `a299ba1` before
   #2; both are contained in the final #16 and #8.)
2. Then #17 (fixes), then #8 (this PR) last.
3. Every PR after #1 is based on `bootstrap/phase-1-skeleton`, `bootstrap/phase-2-claude-md`
   (#14) or `main`; retarget each to `main` as its base merges. #17 and #8 are based on the
   integration and fix branches and are retargeted to `main` last.
4. #14 is merged, not closed: its commits are already in the candidate and in #8, and closing it
   would leave them unreviewed.

## Unresolved work

| Item | Evidence | Smallest resolution | Owner |
|---|---|---|---|
| Human review and merge | 17 open PRs, 0 reviews | Review in the sequence above | founders |
| Devcontainer never built | docker absent | Build it once on a machine with docker | @SatyamDave |
| Study 0001 data not shared | snapshot off git on one machine | Approved shared store; check Kalshi data terms | founders |
| Protected patches unapplied | `docs/proposals/0001-0003` apply cleanly | A human applies each in its own PR | founders |
| autonomy-gate T2 on #17, #8 | gate fails without approval | Human approval on the PR | founders |
| Demo DSR trial count | a non-recorded demo run counts trials in its scratch ledger only | Note in the report text or code | #12 area owner |

## Contradictions

| Topic | Evidence | Impact | Smallest resolution |
|---|---|---|---|
| Custom engine vs NautilusTrader | No `nautilus` in any manifest or lockfile; ADR-0001 (Proposed) says the first engine-core PR adds it; #15 did not | The running engine is the in-house `qc-*` crates | Amend or reject ADR-0001 (in-house is its listed fallback) |
| JSONL registry vs MLflow | One JSONL ledger at `research/registry/log/` (`QC_REGISTRY_DIR` override), 5 rows (4 demo, 1 study); ADR-0005 Decision 5 says MLflow | JSONL is the implemented source of truth | Amend ADR-0005 or plan a migration |
| Toolchain pin | `rust-toolchain.toml` `stable` (now says it floats); ADR-0004 says 1.98.1; CI installs current stable; verified on 1.97.1 | Builds can use different compilers | Apply `0001-rust-toolchain-pin.patch` after ADR-0004 approval, or amend the ADR |
| Remaining false greens | `just audit` skips exit 0 locally (not in CI); walk-forward exits 0 on FAIL | A local green can hide a missing scanner | Read the `SKIPPED` lines; treat the verdict line, not the exit code, as the walk-forward result |
| Token-bucket test (#15) | One commit touches `pacing.rs`; the earlier failing version is not in any branch or log; current assertions match the documented contract | Could not confirm no assertion was weakened | #15 author states in the PR what changed and why |
| SimVenue fills | `gateway/src/sim.rs`: queue position ignored; displayed size not reduced | Replay shows determinism, not execution quality | Never cite replay or SimVenue as fill evidence |
| Promotion metrics | GATES.md "starting defaults to be reviewed"; `deflated_sharpe` returns a probability in [0, 1]; `GATE_DSR = 1.0` | DSR gate effectively unreachable; Sharpe 1.5 has no stated units | Human redefines the gates; no numbers proposed here |
| Two-founder review | One collaborator; all PRs by @SatyamDave; rulesets and protection 403; CODEOWNERS catch-all last | No approval rule is enforced | Policy in [TEAM.md](../TEAM.md); `0003-codeowners-order.patch` |
| Automation | `scripts/ci/ai_gate.py` exists (15 tests) but the workflows do not call it until `0002-ai-workflow-gating.patch` is applied | No paid call today (no key, nothing on `main`); after merge plus a key, four workflows would run ungated | Apply 0002 before adding `ANTHROPIC_API_KEY` |
| TypeSafe distillation | ADR-0011 quotes MCA §2.3(b) | Decision-layer Phase 5 blocked; nothing implemented | Keep blocked pending legal review |
| Safeguard scope | Model hash check is integrity, not provenance; `guard-protected.sh` hooks Edit/Write only; no scrubber exists | Hooks help inside Claude Code only | State demonstrated scope only |
| Kill switch | `replay/src/lib.rs` `halt()` stops order entry and requests cancels | Cancels not awaited; positions not flattened; no external trigger | [kill-switch runbook](../runbooks/kill-switch.md) |
| Vision wording | "Self-learning model stack" still in the `ml/__init__.py` docstring | Overstates what exists | Code, left for its owner; docs reworded |

## What fixtures and simulation cannot establish

Replay on a synthetic day shows the engine is deterministic and the risk checks fire; it says
nothing about fills, queue position, latency or any venue. The walk-forward demo exercises the
pipeline on synthetic data; its FAIL is not evidence about any strategy. Study 0001 ended
INSUFFICIENT EVIDENCE with zero analysable markets, so the favorite-longshot hypothesis is
untested, not refuted. No measurement of network or venue latency exists.
