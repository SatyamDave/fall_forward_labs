# Base status report (2026-09-28)

What exists on `main`, what was verified, what is still open, and the two verdicts. This is a
status report for an offline foundation, not a "base complete" report for a trading system.

- **Audited revision:** `main` at `9f39eee` (merge of #17). Every PR except #8 (this docs PR) is
  merged. #8's diff over `main` is Markdown only.
- **Environment:** clean clone on macOS 27.2 arm64; rustc/cargo 1.97.1 from Homebrew with no
  rustup (so `engine/rust-toolchain.toml` is not honoured); uv 0.11.28 (venv CPython 3.12.13);
  just 1.58.0; cargo-deny, cargo-audit, pip-audit installed; docker not installed.
- **Evidence source:** an independent verifier ran the commands below on `9f39eee` and captured
  every exit code directly with `pipefail`; its logs are kept outside the repository. I re-ran
  `just check` and `just replay` on #8's head (main plus docs) with the same results.
  Per-component inventory: [docs/audits/0001-reality-audit.md](../audits/0001-reality-audit.md).

## Verdicts

**Documentation: complete for `main` `9f39eee` plus this PR.** It goes stale as soon as a new
commit lands on `main`.

**Engineering foundation: ready as an offline foundation on `main` `9f39eee`.** Each condition of
the final-docs spec §7 is met: a reproducible checkout (`main`); setup and every check pass
(`just check`, CI); genuine offline end-to-end fixture demos (`just replay` against a committed
order-log hash, `just walkforward demo`); documented configuration and interfaces
([ARCHITECTURE](../ARCHITECTURE.md)); visible operating limits (root `CLAUDE.md`,
[kill-switch runbook](../runbooks/kill-switch.md)); contributor instructions
([CONTRIBUTING](../../CONTRIBUTING.md)); and the open items below. It is not a trading system,
it connects to no venue, and it has shown no edge.

Conditions that stay open, none of which a fixture can settle:

1. Nothing is platform-enforced: branch protection and rulesets return HTTP 403 on this plan.
2. The second founder is unknown, so no PR can get a second human approval.
3. The devcontainer has never been built (no docker).
4. Study 0001's snapshot exists only outside git on one founder's machine; a clean clone cannot
   reproduce it. Kalshi's data terms for sharing it are UNVERIFIED.
5. ADRs are Proposed; the ADR-0004 toolchain pin (`docs/proposals/0001-rust-toolchain-pin.patch`)
   is unapplied; the deflated-Sharpe threshold is undecided; the first vertical is PENDING.
6. No `ANTHROPIC_API_KEY` exists; the AI workflows are gated off by `autonomy/POLICY.yaml`.

## How the PRs were merged

On the owner's explicit instruction on 2026-09-28, #1-#7 and #9-#17 were merged into `main` in
this order: #5, #1, #7, #14, #10, #11, #12, #13, #15, #2, #3, #4, #9, #16, #6, #17. #8 merges last.

- **Review.** Agent reviewers posted findings on each PR as COMMENT reviews (the coordinator
  reports four review agents per PR). These are not approvals: GitHub does not let an author
  approve their own PR, and every PR is authored by @SatyamDave. Blockers and majors were fixed on
  the source branches before merge, for example: #15 (kill switch during a disconnect, reference
  price during resync, reconcile gating, daily-loss halt, committed replay hash, release overflow
  checks), #12 (a FAIL cannot be promoted), #13 (SECURITY.md claim; security-review restores the
  base config), #11 (case-insensitive hooks, fail closed, new limit files, protected
  `settings.local.json`, `ai_gate.py` and `scope_check.py`, redaction), #10 (open-PR check, loud
  failure, scope-check exclusions), #3 (only write-or-higher approvers counted), #17 (trial count
  from the canonical ledger, finite budgets). The comments are on each PR.
- **Dated exception, 2026-09-28.** PRs touching protected zones (T3: `engine/crates/risk/**`,
  `config/limits/**`, `.github/workflows/**`, `.claude/hooks/**`, `.claude/settings.json`,
  `autonomy/**`, CODEOWNERS) merged with the second human approval required by root rules 3-4
  **waived by the sole founder**. This was a human decision, not enforcement, and it sets no
  precedent: the next protected change needs the policy in [TEAM.md](../TEAM.md).
- **Protected patches.** `0002-ai-workflow-gating.patch` and `0003-codeowners-order.patch` were
  applied with owner approval. `0001-rust-toolchain-pin.patch` waits for ADR-0004.
- **CI during the merges.** `ci` was red on `main` for two intermediate merges (#16 and #6)
  because of bandit B310, which #17 fixed. It is green from `9f39eee`.

## Commands (on `main` `9f39eee`)

| Command | Exit | Result | Limitation |
|---|---|---|---|
| `just setup` | 0 | `cargo fetch`, `uv sync --locked` | Warm caches; no cold-install time this pass |
| `just check` | **0** | fmt, clippy `-D warnings`, ruff, mypy, every test suite (below), audits | |
| `just audit` (in `check`) | 0 | cargo-deny advisories/bans/licenses/sources ok; no known vulnerabilities | Advisory databases as of 2026-09-28; a missing scanner fails in CI, warns locally |
| `just replay` twice | 0, 0 | `d3400a1a...b8e0` both runs, equal to `tests/replay/expected_order_log.sha256` | Synthetic fixture |
| `just walkforward demo` twice | 0, 0 | Verdict FAIL; writes only gitignored `out/`; `git status` clean | Synthetic data; exit code does not reflect the verdict |
| `just study-0001`, no snapshot | 2 | refuses, lists the catalogued hashes | Intended |
| `just study-0001`, preserved snapshot, twice | 0, 0 | `results.json` sha256 `115aca07...` matches the committed file | Snapshot is off git |
| `just backtest demo` | 2 | "not implemented" | Placeholder |
| `just paper demo` | 1 | refuses: no venue connections | Intended |
| `cargo bench ... --no-run` | 0 | both benches build | No timings measured |
| devcontainer build | NOT RUN | docker not installed | |

| Suite in `just test` | Result |
|---|---|
| Rust `cargo test --workspace` | 47 passed |
| research, ml, data | 27 passed |
| hooks `tests/hooks` | 62 passed |
| knowledge `tests/knowledge` | 16 passed |
| autonomy `tests/autonomy` | 29 passed |
| AI gate `tests/ci` | 17 passed |
| study 0001 | 13 passed, 1 skipped by design (no primary metric when zero markets were analysable) |

CI on `main` `9f39eee`: `ci` success (run 36365980069), `security` success (36365980505),
`scorecard` success (36365980030). codeql skips (`vars.CODE_SCANNING` unset); sbom runs on
releases only; the AI reviews make no call (gate denied, no key).

## Open items

| Item | Evidence | Smallest resolution | Owner |
|---|---|---|---|
| Unenforceable review | rulesets and branch protection 403 | GitHub plan or organization with rulesets; then the TEAM.md policy | founders |
| Second founder | one collaborator | Add them; they record themselves in TEAM.md | founders |
| Devcontainer | never built | Build once on a machine with docker | @SatyamDave |
| Study 0001 data | snapshot off git on one machine | Approved shared store; check Kalshi data terms | founders |
| Study 0001 v2 | v1 INSUFFICIENT EVIDENCE | Register a new trial with a population sized by metadata-only calls | researcher |
| ADR decisions, DSR threshold, vertical | ADRs Proposed; `GATE_DSR = 1.0` on a probability | Founders decide; no number proposed here | founders |

## Contradictions (current)

| Topic | Evidence | Impact | Smallest resolution |
|---|---|---|---|
| Custom engine vs NautilusTrader | No `nautilus` in any manifest; ADR-0001 (Proposed) says engine-core adds it | The engine is the in-house `qc-*` crates | Amend or reject ADR-0001 |
| JSONL registry vs MLflow | One JSONL ledger at `research/registry/log/`; ADR-0005 says MLflow | JSONL is the source of truth | Amend ADR-0005 or plan a migration |
| Toolchain pin | `rust-toolchain.toml` floats on `stable`; ADR-0004 says 1.98.1 | Builds can use different compilers | Apply patch 0001 after ADR-0004 approval |
| Token-bucket test (#15) | The earlier failing version is not recoverable; current assertions match the contract | Could not confirm no assertion was weakened | Author notes what changed |
| SimVenue fills | Queue position ignored; displayed size not reduced | Replay shows determinism, not execution quality | Never cite replay as fill evidence |
| Promotion metrics | GATES.md defaults unreviewed; DSR is a probability, gate is `>= 1.0` | DSR gate effectively unreachable | Founders redefine |
| Two-founder review | Sole founder waived the second approval on 2026-09-28 | Rules 3-4 were not met for those merges | Dated exception above; policy in TEAM.md |
| Safeguard scope | Model hash check is integrity, not provenance; hooks bind Claude Code only | Not enforcement | State scope only |
| Kill switch | Halts new orders and cancels (resent until none open) in simulation | No flattening, no external trigger | [kill-switch runbook](../runbooks/kill-switch.md) |
| Vision wording | `ml/__init__.py` docstring says "Self-learning model stack" | Overstates what exists | Code, left for its owner |

## What fixtures and simulation cannot establish

Replay on a synthetic day shows the engine is deterministic and the risk checks fire; it says
nothing about fills, queue position, latency or any venue. The walk-forward demo exercises the
pipeline on synthetic data; its FAIL is not evidence about any strategy. Study 0001 ended
INSUFFICIENT EVIDENCE with zero analysable markets, so the favorite-longshot hypothesis is
untested, not refuted. No network or venue latency has been measured.
