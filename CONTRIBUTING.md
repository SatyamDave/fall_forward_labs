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
`config/limits/`. A GitHub ruleset (added in the security-pipeline phase) is what actually
requires two human approvals on these paths in the GitHub UI — CODEOWNERS alone can only request
review, not require a count, so don't rely on CODEOWNERS as the enforcement mechanism. Loosening a
risk limit specifically always needs two human approvals (root rule 4), regardless of who or what
proposed it.

## The knowledge loop

Session learnings land in `.claude/learnings/inbox/` (via the Stop hook), get triaged into nested
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

## Before opening a PR

- `just check` passes locally (or in the devcontainer).
- Tests were added or updated for behavior changes, and — where the change is a bug fix — you can
  show the test failing before the fix.
- Docs are updated for any changed behavior (a nested `CLAUDE.md`, a runbook, the glossary).
- If your change touches a protected zone, say so in the PR and expect a risk-auditor or human
  review before merge, not just CI green.
