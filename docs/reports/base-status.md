# Base status report (2026-09-27)

What exists, what was verified, what is unresolved, and the two verdicts for this snapshot. This
is not a "base complete" report; the base is not complete.

- **main:** `4975ec3` (`chore: initial commit`, one README). No PR is merged.
- **Integration candidate:** `integration/base-candidate-2026-09-27` at `44d1711`, every open PR
  head except #6 merged with `--no-ff`. Unreviewed, not main. Last candidate commit where
  `just check` exits 0: `f4a4537`.
- **Documentation branch:** `bootstrap/phase-7-contributor` (#8) = candidate plus docs only.
- **Evidence source:** an independent verifier agent ran every command below in fresh clones on
  2026-09-27 and captured each exit code directly with `pipefail` set. Its report and logs are
  kept outside the repository; the tables here are imported from it. The inventory by component is
  [docs/audits/0001-reality-audit.md](../audits/0001-reality-audit.md).
- **Environment:** macOS 27.2 arm64; rustc/cargo 1.97.1 from Homebrew with no rustup (so
  `engine/rust-toolchain.toml` was not honoured); uv 0.11.28 (venv CPython 3.12.13); just 1.58.0;
  cargo-deny, cargo-audit and pip-audit installed; docker not installed.

## Verdicts

**Documentation: complete for this snapshot.** README, NOW, ARCHITECTURE, ROADMAP, TEAM,
CONTRIBUTING, onboarding, runbooks, glossary, specs index and this report describe the candidate as
verified above. It goes stale as soon as a PR merges or a new commit lands.

**Engineering foundation: partially ready.** Met: setup and checks work offline without
credentials at `f4a4537`; one genuine offline end-to-end fixture demo (`just replay`) is
deterministic; interfaces, limits and open work are written down. Unmet:

1. No reproducible checkout on `main`; everything sits on 16 open, unreviewed PRs.
2. `just check` fails at the candidate head (RUF100, #16 combined with #12).
3. Integration blockers: `docs/NOW.md` (#6 vs #14), split registry (#12 vs #16), and a trivy
   HIGH (DS-0002, root user in `.devcontainer/Dockerfile`) that fails `security` on the combined tree.
4. Study 0001 cannot be reproduced from a clean clone (raw data gitignored, not stored elsewhere).
5. Rust toolchain floats on `stable` against ADR-0004's pin; devcontainer never built.
6. Hook, knowledge, autonomy and study suites run outside `just check` and CI.
7. Review rules unenforced: no branch protection or rulesets on this plan, one collaborator,
   CODEOWNERS catch-all overriding the protected paths.
8. Every ADR is Proposed; the GATES.md thresholds are unapproved and the deflated-Sharpe gate is
   mis-scaled.
9. Placeholders and skips exit 0 (`just backtest`, `just audit` skips); walk-forward registers a
   challenger on FAIL.

Not blockers for the offline foundation, and each a separate milestone: venue eligibility and
jurisdiction, real market data, execution calibration, forward validation, live deployment.

## Commands

"Candidate" is `44d1711` unless named.

| Command | Revision | Exit | Result | Limitation |
|---|---|---|---|---|
| `just check` | main `4975ec3` | 1 | `error: no justfile found` | main has only a README |
| `just setup` (empty cargo and uv caches) | `c8800dd` | 0 | 133 crates from crates.io, PyPI packages into `research/.venv`; 6 s (5 s on `f4a4537`) | Fast network; does not install Rust, Python or just |
| `just check` (cold target) | `f4a4537` | **0** | fmt, clippy `-D warnings`, 42 Rust tests, 20 pytest, cargo-deny, cargo-audit, pip-audit; 21 s | Missing audit tools print "skip" and still exit 0 |
| `just check` | candidate | **1** | ruff RUF100 at `research/studies/0001-favorite-longshot/tests/test_recompute.py:44` | Integration blocker |
| `just check` | #16 `210ee77` alone | 0 | audit printed `skip: cargo-deny or engine/deny.toml missing` | False-green path |
| `just test` | candidate | 0 | 42 Rust tests, 20 pytest | See discovery table |
| `just audit` | candidate | 0 | cargo-deny ok; cargo-audit 0 vulnerabilities in 126 crates; pip-audit none | Advisory databases as of 2026-09-27 |
| `just replay` twice | candidate | 0, 0 | `d3400a1ab2c32bb4177aa94ab96eef25d53a40a74a62028d46ad5f614b88b8e0` every run; 3 s | Synthetic fixture; compares two runs, no committed golden hash |
| `just walkforward demo` | `c8800dd`, scratch clone | 0 | Verdict FAIL (DSR 0.0000, PBO 0.3429, 0% positive folds) | Overwrites the committed dated report; appends 4 trials and 1 challenger to the committed registry; exits 0 on FAIL |
| `just study-0001` twice | candidate, fresh clone | 1, 1 | `FileNotFoundError: data/raw/study-0001/listing/manifest.json` | Raw snapshot gitignored; results not reproducible from a clone |
| `uv run pytest studies/0001-favorite-longshot/tests` | candidate | 0 | 6 passed, 1 skipped (recompute on real data) | |
| `just test-hooks` | candidate | 0 | 30 passed | Not in `check` or CI |
| `python3 -m unittest discover -s tests/knowledge` | candidate | 0 | 10 OK | Not in `check` or CI |
| `cd research && uv run pytest ../tests/autonomy -q` | candidate | 0 | 23 passed | Not in `check` or CI |
| `just paper x` | candidate | 1 | refuses: no venue connections | Intended |
| `just backtest x` | candidate | **0** | "not implemented yet" | False green |
| `just learnings` | candidate | 0 | "0 untriaged learning(s)" | |
| `cargo bench ... --no-run` | candidate | 0 | both bench binaries build | No timings measured |
| mermaid-cli on `docs/ARCHITECTURE.md` | candidate | 0 | parsed | Before this PR: planned parts unlabeled |
| devcontainer build | none | NOT RUN | docker not installed | Apple Silicon support unproven |

CI evidence exists only for #13's own head (`4144991`): `ci` (rust, python, miri, just-check)
passed in run 36357795286; semgrep, trivy, osv-scanner and checkov passed in run 36357795901
(codeql and sbom skipped by design: `vars.CODE_SCANNING` is unset); `code-review` and
`security-review` failed in run 36357795340 because no `ANTHROPIC_API_KEY` exists, before any API
call. #3's `autonomy-gate` failed as designed (0 of 2 approvals).

CI on the combined tree ran once, on this PR's head `a0d1ca8` (candidate plus docs), 2026-09-27:
`ci` run 36360222966 had rust and miri pass, python and just-check fail (the same RUF100);
`security` run 36360223381 had semgrep, osv-scanner and checkov pass and **trivy fail with one
HIGH, DS-0002: `.devcontainer/Dockerfile` has no non-root `USER`** (#13 never scanned the
devcontainer, which comes from #8); codeql and sbom skipped. `ai-review` failed for want of a
key, before any API call. No other PR has run CI, and "no checks" means nothing ran.

### Test discovery

| Suite | In `just check` | In CI | Result |
|---|---|---|---|
| Rust tests, `engine/crates/*` (42) | yes | yes, plus miri | 42 passed |
| research registry, ml, data quality | yes | yes | 1 + 16 + 3 passed |
| hooks `tests/hooks` | no (`just test-hooks`) | no | 30 passed |
| knowledge `tests/knowledge` | no | no | 10 OK |
| autonomy `tests/autonomy` | no | no | 23 passed |
| study 0001 tests | no (`just study-0001`) | no | 6 passed, 1 skipped |

## Merge sequence

Proposed for human review. Each step merges one PR after its checks and review; nothing here was
merged.

1. #5 (ADRs, docs only) into `main`.
2. #1 (skeleton) into `main`, then retarget #7, #8, #10-#13, #15, #16 to `main`.
3. #7, then #14 (based on #7). Before #14, decide `docs/NOW.md`: this PR's version replaces both
   #14's and #6's; close #6 or reduce it to `docs/plans/0006-team.md`.
4. #13 (CI) so later PRs run checks, then #11, #10, #12, #15.
5. #16 after #12: drop the `# noqa: S311` at `test_recompute.py:44` and point `record_trial.py`
   at `research/registry/log/trials.jsonl`.
6. #2, #3, #4, #9 (drafts; docs and policy) once their decisions are made.
7. #8 (this PR) last, retargeted to `main`, so its diff is docs only.

## Unresolved integration work

| Item | Evidence | Smallest resolution | Owner |
|---|---|---|---|
| Red `just check` at candidate | RUF100, `test_recompute.py:44`; #12's ruff config ignores S311 in tests | Remove that noqa in #16 after rebasing on #12 | #16 author |
| Two NOW.md files | add/add conflict #6 vs #14; #6 excluded from candidate | Human picks one; this PR proposes its version | founders |
| Trivy HIGH DS-0002 on the combined tree | run 36360223381: `.devcontainer/Dockerfile` has no non-root `USER` | Add a non-root user to the devcontainer and build it once (not done here: docker unavailable, so it could not be tested) | #8 author |
| Split trial ledger | #12 `research/registry/log/trials.jsonl`; #16 `research/registry/trials.jsonl` | Point #16 at `log/` | #16 author |
| Demo trials in committed registry | 4 demo trials and 1 challenger committed by #12; each run adds more | Remove demo rows or write demo runs to a scratch path | #12 author |
| Strategy trait doc drift | `engine/crates/strategy-runtime/CLAUDE.md` (#7) vs #15 trait | Fixed in this PR | done here |

## Contradictions

| Topic | Evidence | Impact | Smallest resolution |
|---|---|---|---|
| Custom engine vs NautilusTrader | No `nautilus` in any manifest or lockfile; ADR-0001 (Proposed) says the first engine-core PR adds it; #15 did not | The running engine is the in-house `qc-*` crates | Amend or reject ADR-0001 (in-house is its listed fallback) |
| JSONL registry vs MLflow | `ml/registry/__init__.py` claims ADR-0005 "allows either"; ADR-0005 Decision 5 says MLflow | JSONL is the real source of truth, split in two | Document JSONL as implemented; fix ADR-0005 wording in review |
| Toolchain pin | `rust-toolchain.toml` `stable`; ADR-0004 says 1.98.1 exactly; CI installs current stable; devcontainer `rust:1-bookworm` by digest; verified locally on 1.97.1 | Builds can use different compilers | Pin in its own PR per ADR-0004, or amend the ADR |
| False-green commands | `just backtest` exits 0; audit skips exit 0; walk-forward exits 0 on FAIL | A green run can hide missing work | Make placeholders exit non-zero; fail audit on missing tools in CI |
| Token-bucket test (#15) | One commit touches `pacing.rs`; the earlier failing version is not in any branch or log. Current assertions match the documented contract | Could not confirm no assertion was weakened | #15 author states in the PR what changed and why |
| SimVenue fills | `gateway/src/sim.rs`: queue position ignored; displayed size not reduced, so two aggressive orders can take the same quantity | Replay shows determinism, not execution quality | Never cite replay or SimVenue as fill evidence |
| Promotion metrics | GATES.md "starting defaults to be reviewed"; `deflated_sharpe` returns a probability in [0, 1]; `GATE_DSR = 1.0` | DSR gate effectively unreachable; Sharpe 1.5 has no stated units (per trade, not annualized) | Human redefines the gates; no numbers proposed here |
| Two-founder review | One collaborator; all PRs by @SatyamDave; authors cannot approve their own PR; rulesets and protection 403; CODEOWNERS catch-all last | No approval rule is enforced | Policy proposal in [TEAM.md](../TEAM.md); move the CODEOWNERS catch-all first (proposed in #8's description; a human applies it) |
| Automation | POLICY.yaml `enabled: false`, but no workflow reads it; knowledge-sync, ai-review, gardener, learnings-triage call claude-code-action with only `--max-turns` | No paid call today (no key, no workflows on main); after #10/#13 merge and a key is added, those four run regardless of POLICY.yaml | Gate them on a variable or POLICY check with a budget before adding the key |
| TypeSafe distillation | ADR-0011 quotes MCA §2.3(b) | Decision-layer Phase 5 blocked; nothing implemented | Keep blocked pending legal review |
| Safeguard scope | Model hash check: the same PR can change bytes and hash (integrity, not provenance). `guard-protected.sh` hooks Edit/Write only; `Bash(uv *)` can write protected paths. No scrubber exists | Hooks are a convenience inside Claude Code, not enforcement | State demonstrated scope only |
| Kill switch | `replay/src/lib.rs` `halt()` stops order entry and requests cancels | Cancels are not confirmed; positions not flattened; no external trigger | Documented in the kill-switch runbook |
| Vision wording | "zero vulnerabilities", "self-learning" in VISION and `ml/__init__.py` | Overstates what exists | Reworded in docs here; `ml/__init__.py` is code, left for its owner |

## What fixtures and simulation cannot establish

Replay on a synthetic day shows the engine is deterministic and the risk checks fire; it says
nothing about fills, queue position, latency or any venue. The walk-forward demo exercises the
pipeline on synthetic data; its FAIL is not evidence about any strategy. Study 0001 ended
INSUFFICIENT EVIDENCE with zero markets analysed, so the favorite-longshot hypothesis is untested,
not refuted. No measurement of network or venue latency exists.
