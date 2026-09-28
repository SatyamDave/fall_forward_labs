# Plan 0001: quant-core bootstrap

This plan is the source of truth for the bootstrap of quant-core (this repository, `SatyamDave/fall_forward_labs`). It records the branch layout, who owns which paths, the status of each phase, and every place where current documentation or facts contradict the bootstrap prompt. It is written to survive context compaction: a new session should be able to resume from this file alone.

The full bootstrap prompt is the owner's spec (sections 0 to 13). Section numbers below (for example "§3") refer to it.

## Goal

Stand up a private algorithmic trading platform whose repository enforces the twelve non-negotiable rules from day one: a Rust engine with no AI calls in the live path, Python research and ML, an offline agent workflow whose only outputs are PRs and reports, and automated security and knowledge gates. No live venue connections, keys or orders are part of the bootstrap (§13).

## Branch layout and orchestration

The owner asked for parallel orchestration, so the phases do not run strictly one after another.

```
main
├── bootstrap/phase-0-decisions      (this branch: plan + ADRs)
└── bootstrap/phase-1-skeleton       (directory tree, compiling engine workspace, uv project)
    ├── bootstrap/phase-2-claude-md
    ├── bootstrap/phase-3-claude-config
    ├── bootstrap/phase-4-security
    ├── bootstrap/phase-5-knowledge-loop
    ├── bootstrap/phase-6-ml
    ├── bootstrap/phase-7-contributor
    └── bootstrap/engine-core        (lane: first real engine crates)
```

1. Phase 0 (decisions) and Phase 1 (skeleton) branch from `main` in parallel. They touch disjoint paths, so either can merge first.
2. Phases 2 to 7 and the engine-core lane branch from `bootstrap/phase-1-skeleton` and run in parallel. Each owns a disjoint set of paths (table below), so their PRs can be reviewed and merged in any order after Phase 1 merges.
3. Each phase and the lane is its own PR against `main`. Stacked PRs are rebased onto `main` after Phase 1 merges; nobody force-pushes a shared branch, so a rebase that needs a force-push is done by opening a fresh branch instead.
4. Agents never push to `main`, never force-push and never merge. A human merges.

### Path ownership

| Branch | Owns (may create or edit) | Must not touch |
|---|---|---|
| phase-0-decisions | `docs/plans/`, `docs/adr/` | everything else |
| phase-1-skeleton | the directory tree in §4, placeholder READMEs, `engine/` workspace files, `research/pyproject.toml` and `uv.lock`, `justfile`, root dotfiles | `docs/plans/`, `docs/adr/` |
| phase-2-claude-md | every `CLAUDE.md` (root and nested) | all other files |
| phase-3-claude-config | `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/`, `.claude/agents/`, `.claude/skills/`, `engine/.claude/`, `research/.claude/`, `ml/.claude/`, `tests/hooks/` | `CLAUDE.md` files, `.github/` |
| phase-4-security | `.pre-commit-config.yaml`, `engine/deny.toml`, `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/workflows/scorecard.yml`, `.github/dependabot.yml`, `docs/runbooks/github-hardening.md`, `scripts/harden-repo.sh`, `ops/` security templates | knowledge-loop workflows, `CLAUDE.md` files |
| phase-5-knowledge-loop | `.github/workflows/knowledge-*.yml`, `.github/workflows/learnings-triage.yml`, `.github/workflows/gardener.yml`, `.claude/learnings/`, `docs/research/journal/` | `.claude/hooks/` (Phase 3 writes the Stop hook), security workflows |
| phase-6-ml | `ml/` except `ml/CLAUDE.md` and `ml/.claude/` | `engine/`, `CLAUDE.md` files |
| phase-7-contributor | `README.md`, `CONTRIBUTING.md`, `docs/onboarding/`, `docs/GLOSSARY.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/`, `.github/CODEOWNERS`, `.devcontainer/` | workflows, `CLAUDE.md` files |
| engine-core | `engine/crates/**` source, `engine/benches/`, `engine/fuzz/`, `tests/replay/`, `tests/chaos/` | `engine/crates/risk/**` beyond a proposal PR for human approval, `CLAUDE.md` files, `engine/.claude/` |

`.github/workflows/`, `.claude/hooks/`, `.claude/settings.json`, `engine/crates/risk/**`, `config/limits/**`, `ops/deploy/**` and `fund/**` are protected zones (root rule 3). A branch may propose changes there, but a human approves them.

## Status

> **Status note, 2026-09-28:** the table below is the plan as written and is out of date. Current state, including which phases were built and merged, is in [docs/reports/base-status.md](../reports/base-status.md).

| Phase | Branch | PR | Status |
|---|---|---|---|
| 0 Decisions (plan, ADR-0000 to ADR-0005) | bootstrap/phase-0-decisions | [#5](https://github.com/SatyamDave/fall_forward_labs/pull/5) | Ready for review. All ADRs are "Proposed" and wait for human approval. |
| 1 Skeleton | bootstrap/phase-1-skeleton | [#1](https://github.com/SatyamDave/fall_forward_labs/pull/1) | In progress |
| 2 CLAUDE.md hierarchy | bootstrap/phase-2-claude-md | not opened | In progress |
| 3 .claude/ configuration | bootstrap/phase-3-claude-config | not opened | In progress |
| 4 Security pipeline | bootstrap/phase-4-security | not opened | In progress |
| 5 Self-growing knowledge loop | bootstrap/phase-5-knowledge-loop | not opened | In progress |
| 6 ml/ self-learning stack | bootstrap/phase-6-ml | not opened | In progress |
| 7 Contributor experience | bootstrap/phase-7-contributor | not opened | In progress |
| Engine-core lane | bootstrap/engine-core | not opened | In progress |

Update this table in each phase's PR, or in a follow-up once the PR merges.

## Phase 0 report

**Built.** This plan; `docs/adr/0000-template.md`; ADR-0001 (engine foundation), ADR-0002 (dependencies and licenses), ADR-0003 (venue selection), ADR-0004 (languages and toolchain), ADR-0005 (data storage). Every factual claim in the ADRs cites a URL and was checked on 2026-09-27.

**Verified.** Library versions, release dates and last-commit dates through `gh api`; repository licenses through `gh api repos/<o>/<r>/license`; registry licenses and Python version constraints through the PyPI and crates.io JSON APIs; venue facts through each venue's own pages where reachable. `just check` does not exist on `main` yet (Phase 1 adds the `justfile`), so this documentation-only phase has no automated check to run.

**Open.** Every ADR is "Proposed". The decisions needing a human are listed next.

**Decisions needing a human.**

1. The operators' legal jurisdiction (country, and state if in the US) and the legal entity that will trade. ADR-0003 cannot recommend a venue without it.
2. Venue choice for the first paper-trading and recording work (ADR-0003), after jurisdiction is confirmed.
3. Legal review of LGPL-3.0 for NautilusTrader before the fund stage or before any binary is given to a third party (ADR-0001, ADR-0002).
4. Acceptance of hftbacktest despite roughly nine months without commits (ADR-0001).
5. Approval, amendment or rejection of each ADR, which moves its status from "Proposed" to "Accepted" or "Rejected".

## Differences from the bootstrap prompt

These are places where current documentation or facts contradict or refine the prompt. Per §0, the docs win and the difference is recorded here.

1. **Python version.** §3 (ADR-0004) says "Python 3.12+". RD-Agent 1.0.0 declares support only for Python 3.10 and 3.11 ([PyPI](https://pypi.org/project/rdagent/)), and qlib 0.9.7 ships wheels only up to CPython 3.12 ([PyPI](https://pypi.org/project/pyqlib/)). ADR-0004 therefore proposes 3.12 for the main research environment and a separate 3.11 environment for `research/sandbox/`.
2. **hftbacktest maintenance.** §3 proposes hftbacktest as the market-making fill simulator. Its last release is from 2025-12-10 and its last commit from 2025-12-23 ([releases](https://github.com/nkaz001/hftbacktest/releases)), so it is less actively maintained than the prompt implies. ADR-0001 keeps it, behind a replaceable fill-model interface.
3. **qlib scope.** qlib's README describes China and US equity data and does not mention crypto ([README](https://github.com/microsoft/qlib)). That fits the prompt's "research sandbox only" use but means crypto factor discovery with qlib needs our own data loaders.
4. **NautilusTrader license variant.** The prompt says "LGPL". The Python package is labeled LGPL-3.0-or-later ([PyPI](https://pypi.org/project/nautilus_trader/)) and the Rust crates LGPL-3.0-only ([crates.io](https://crates.io/crates/nautilus-model)). Counsel should review the variant we actually link.
5. **LightGBM repository.** `microsoft/LightGBM` now resolves to `lightgbm-org/LightGBM` ([LICENSE](https://github.com/lightgbm-org/LightGBM/blob/main/LICENSE)). The license is still MIT.
6. **Rust toolchain pin.** The Phase 1 skeleton sets `channel = "stable"` in `engine/rust-toolchain.toml`. ADR-0004 proposes an exact pin (1.98.1 today, matching NautilusTrader's own pin) so that builds and the replay test are reproducible. This is a follow-up for whichever branch owns `engine/` workspace files once ADR-0004 is approved, not a change this branch makes.
7. **Repository name.** The prompt calls the repository root `quant-core/`. The repository is `SatyamDave/fall_forward_labs`; quant-core is the platform codename.
8. **Claude Code memory loading (§5).** The current [memory docs](https://code.claude.com/docs/en/memory) confirm the prompt's loading model: CLAUDE.md files in the launch directory and above load at launch, subdirectory CLAUDE.md files load when Claude reads files there, the project-root CLAUDE.md is re-read and re-injected after `/compact`, and `.claude/rules/` files with `paths:` frontmatter load when matching files are read. The docs recommend under 200 lines per CLAUDE.md; the prompt's budgets (150 root, 80 nested) are stricter and remain in force. The docs also state that CLAUDE.md is context, not enforced configuration, and point to PreToolUse hooks for blocking, which matches the prompt's use of hooks for guards. Phases 2 and 3 must re-verify the hooks, settings, skills and subagents pages themselves; Phase 0 checked only the memory page.
9. **Venue landscape (§1, §3).** The prompt's initial arena of "liquid crypto perps + spot" assumes perpetual swaps are available. If the operators are US persons, most offshore perp venues refuse them, and the US alternatives are CFTC-regulated perpetual-style futures (Coinbase Derivatives, Kraken Derivatives US on Bitnomial) or CME futures, each with different contract terms. Deribit now brands itself "Deribit by Coinbase" ([Deribit](https://www.deribit.com/kb/deribit-rate-limits)). The prompt's co-regioning goal also depends on a confirmed matching-engine location, which only some venues publish. See ADR-0003 for sources.
