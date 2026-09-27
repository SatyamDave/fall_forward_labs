# Contributing

## Branch naming

`bootstrap/phase-N-<name>` during the initial bootstrap; after that, `<type>/<short-description>`
where `<type>` matches the conventional-commit type (`feat/`, `fix/`, `refactor/`, `docs/`, …).
Branch from `main`, never commit directly to it.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`, e.g.
`feat(engine/oms): add exhaustive order state machine`. Scope is usually the crate or top-level
directory. Keep commits small and reviewable — one logical change each.

## PR size

Prefer PRs a reviewer can hold in their head: one concern, one crate or directory where possible.
Split unrelated changes into separate PRs even if you found them together. Fill in the PR
template (`.github/pull_request_template.md`) — an unchecked box you can't honestly check is a
sign the PR is doing too much or isn't ready.

## Protected zones

These paths need human approval, not just green CI, before merge:

```
engine/crates/risk/**
config/limits/**
ops/deploy/**
fund/**
.github/workflows/**
.claude/hooks/**
.claude/settings.json
autonomy/**
```

`guard-protected.sh` (`.claude/hooks/`) blocks an agent from editing these without
`QC_ALLOW_PROTECTED=1`, and even then refuses any diff that loosens a numeric limit in
`config/limits/`. That hook binds Claude Code Edit/Write only, not Bash, humans or CI. No GitHub
rule enforces review today: branch protection and rulesets return 403 on this plan, CODEOWNERS
only requests review, and a PR author cannot approve their own PR (see
[docs/TEAM.md](docs/TEAM.md#review-and-the-enforcement-gap)). Loosening a
risk limit specifically always needs two human approvals (root rule 4), regardless of who or what
proposed it.

## The knowledge loop

Designed, not yet running (the workflows need an API key and have never run). Session learnings
land in `.claude/learnings/inbox/` (via the Stop hook), get triaged into nested
`CLAUDE.md` "Learned" sections, skills, or rules by `knowledge-sync.yml` and weekly triage, and go
out as a single PR labeled `knowledge` for human review. Don't hand-edit a nested `CLAUDE.md`
outside of a `knowledge`-labeled PR unless a human asks you to — that defeats the point of having
a reviewable trail. See `docs/onboarding/how-this-repo-learns.md` for the full loop.

## Using Claude Code here

- Start Claude Code from the directory you're actually working in (e.g. `engine/crates/risk/`),
  not always the repo root — nested `CLAUDE.md` files and `.claude/rules/*.md` load based on where
  you are and which files you touch, so starting closer to the work loads more relevant, more
  specific instructions.
- Prefer an existing skill in `.claude/skills/` over improvising a procedure — e.g. `new-strategy`,
  `run-walkforward`, `security-fix`. Skills encode the steps this repo has already agreed on.
- Run `/context` to see what's actually loaded (which `CLAUDE.md` files, which rules, token
  budget) before assuming Claude knows something. This repo's root `CLAUDE.md` is reloaded after
  `/compact`, but a session that has drifted or been running a long time is worth checking.
  `/context` is a current Claude Code command — verify it's still current for your installed
  version against the live docs (https://code.claude.com/docs/llms.txt) if it ever seems to
  behave differently than described here, since this file can't auto-update when the CLI does.

## Checks

Run from the repo root. Expected results are from the verified run on 2026-09-27
([docs/reports/base-status.md](docs/reports/base-status.md)).

| Command | Purpose | Expected output |
|---|---|---|
| `just setup` | Fetch crates, create `research/.venv` from `uv.lock` | exit 0 |
| `just check` | fmt check, clippy `-D warnings`, `cargo test`, pytest, audits | exit 0 (exit 1 at candidate `44d1711`: RUF100, see base-status). A `skip:` line means an audit tool is missing and did not run |
| `just test-hooks` | `.claude/hooks` tests (not in `check`) | `30 passed` |
| `python3 -m unittest discover -s tests/knowledge` | knowledge scripts (not in `check`) | `OK` (10 tests) |
| `cd research && uv run pytest ../tests/autonomy -q` | autonomy classifier (not in `check`) | `23 passed` |
| `just replay` | determinism of the engine on the synthetic day | two identical sha256 lines, `replay deterministic` |
| `git diff --name-only <base>... \| python3 scripts/knowledge/scope_check.py` | Scope, CLAUDE.md budgets and Learned format for docs-only PRs (reads changed paths) | exit 0, no output |

`just backtest` is a placeholder that exits 0; do not treat it as a check.

## Before opening a PR

- `just check` passes locally, and the suites outside it pass if you touched their areas.
- Tests were added or updated for behavior changes, and — where the change is a bug fix — you can
  show the test failing before the fix.
- Docs are updated for any changed behavior (a nested `CLAUDE.md`, a runbook, the glossary).
- If your change touches a protected zone, say so in the PR and expect a risk-auditor or human
  review before merge, not just CI green.
