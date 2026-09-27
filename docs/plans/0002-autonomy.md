# Plan 0002: quant-core autonomy layer

Governing principle: autonomy is earned per category, measured continuously,
and revoked automatically. The system may act on its own only where its
measured track record justifies it, and never in zones that can lose money or
weaken safety.

This plan is the source of truth for the autonomy work. Each phase gets its
own branch (`autonomy/phase-<x>-<name>`) and PR, then stops for approval.
Nothing is pushed to main or merged by an agent.

## Precondition: bootstrap first

Per the autonomy spec, autonomy runs only after the bootstrap
(docs/plans/0001-bootstrap.md) is merged. **No loop may be enabled, and no
auto-merge may be switched on, until every bootstrap PR is merged** and the
Phase H circuit breakers exist with passing trip tests.

`autonomy/POLICY.yaml` ships with `"enabled": false` and every loop disabled,
so merging Phase A changes nothing at runtime. The Phase A PR should still
merge after the bootstrap PRs so that CODEOWNERS, branch protection and the
protected-zone hooks cover `autonomy/` from the moment it lands.

| Bootstrap PR | What autonomy needs from it |
|---|---|
| phase-0 (plan 0001, ADR-0001..0005) | ADR numbering. This plan takes ADR-0006. |
| phase-1 skeleton | The directories the policy globs refer to (`research/registry/`, `docs/research/`, `.claude/learnings/`, `agents/`). |
| CLAUDE.md / `.claude/` lane | The `risk-auditor` and `code-reviewer` agents; `guard-protected.sh`; settings deny rules. |
| CI / security lane | `ci.yml` running `tests/autonomy`; `.claude/rules/workflows.md`; hardening script. |
| CODEOWNERS / contributor lane | Owner entries for `autonomy/`; PR template tier line. |

## Phases

| Phase | Deliverable | Status | Depends on |
|---|---|---|---|
| A | Tiers, `autonomy/POLICY.yaml`, `classify.py`, `autonomy-gate.yml`, ADR-0006 | In review (this PR) | Bootstrap merged before this PR merges |
| B | Nine heartbeat loops on Actions + claude-code-action; GitHub App token runbook (`docs/runbooks/autonomy-bot.md`); global off switch; gate enables T0 auto-merge | Not started | A merged; ADR-0006 accepted; GitHub App created by a human; H breakers for cost and scope |
| C | Backlog brain (`agents/backlog/`): signals, ranking from POLICY.yaml, dedupe, tier labels, needs-human after 2 attempts | Not started | B |
| D | Outcome log (`autonomy/outcomes/*.jsonl` via `just outcome`) and feedback rules | Not started | B |
| E | Agent evals (`agents/evals/`), `just evals`, loop-meta protocol, scorecards | Not started | D |
| F | Memory architecture doc (`docs/onboarding/how-this-repo-learns.md`) and hygiene | Not started | Bootstrap phase 5 |
| G | Metrics (`autonomy/metrics/`, weekly reports, dashboard) | Not started | D, E |
| H | Circuit breakers with trip tests in `tests/autonomy/` | Not started | A. Required before any loop is enabled. |

Loops go live in this order, each through a T3 PR that flips its `enabled`
flag: B (skeletons with loops disabled), then H, then one loop at a time, then
C through G. Phase H is listed last in the spec, but every breaker must exist
before a loop runs ("build before enabling anything").

## Phase A: what is encoded

| Tier | Meaning | Human approvals | Agent review | Auto-merge |
|---|---|---|---|---|
| T0 | Records that cannot affect runtime: research registry data files, graveyard, journal, glossary, learnings inbox/archive, weekly reports | 0 | none | Enabled (acted on from Phase B) |
| T1 | Agent-reviewed: doc fixes (`docs/**/*.md` outside ADRs, plans, runbooks, postmortems) | 1 while T1 auto-merge is off | code-reviewer | Disabled |
| T2 | Default: research, ML, strategy, non-protected engine code, new skills/agents, anything unmatched | 1 | none | Disabled |
| T3 | Protected zones, `autonomy/`, CODEOWNERS, autonomy and hook tests, risk-auditor prompt, `model-promotion` / `strategy-promotion` labels | 2 | risk-auditor | Never |

How a PR is classified (`autonomy/classify.py`):

1. Each changed path is checked, including the old path of a rename. A
   protected path is T3. Otherwise the first matching rule sets the tier, and
   an unmatched path gets `default_tier` (T2).
2. The PR takes the highest tier among its paths.
3. Labels in `label_tiers` can raise the tier but never lower it.
4. A PR is eligible for auto-merge only if its tier allows it and no path is in
   `never_auto_merge_paths`.

The gate counts a human approval only when the reviewer's latest review is an
approval of the head commit, the reviewer is an OWNER, MEMBER or COLLABORATOR,
is a user (not a bot), and is not the PR author. Any outstanding "changes
requested" blocks the gate.

If the PR has more changed files than the files API returned (it stops at
3000), the gate fails rather than classify a partial list.

`autonomy-gate.yml` runs on `pull_request` and `pull_request_review` with a
read-only token. It reads `classify.py` and `POLICY.yaml` from the base
branch, so a PR cannot loosen the rules it is judged by. In Phase A it only
reports and gates. Phase B adds the auto-merge step once the bot token exists.

## Integration with bootstrap (for other lanes to add)

Phase A cannot touch these files. Each item names the lane that owns the file.

1. **CODEOWNERS** (contributor lane): add `/autonomy/ @SatyamDave`,
   `/tests/autonomy/ @SatyamDave`, `/.github/workflows/autonomy-gate.yml
   @SatyamDave`. CODEOWNERS sets who must review, not how many. The
   two-approval requirement comes from the autonomy gate (T3 needs two) being
   a required check.
2. **Branch protection / `scripts/harden-repo.sh`** (security lane): make
   `autonomy-gate / gate` a required status check on main. Also set
   "dismiss stale approvals" to match the gate's head-commit rule.
3. **Protected-zone lists** (`.claude/` lane): add `autonomy/**`,
   `tests/autonomy/**`, `.github/CODEOWNERS` to `guard-protected.sh`, to the
   `.claude/settings.json` Edit deny list, and to `.claude/rules/risk-guard.md`
   `paths:`. Root CLAUDE.md rule 3 is copied verbatim and is not edited. Its
   nested `docs/` or `agents/` CLAUDE.md can point at `autonomy/POLICY.yaml`
   as the full list.
4. **justfile** (skeleton lane): `just autonomy-pause`, which runs
   `gh variable set AUTONOMY_ENABLED --body false --repo
   SatyamDave/fall_forward_labs` (instant) and opens a PR adding
   `autonomy/PAUSE` as the durable record. Also `just autonomy-classify
   <paths>`, which runs `python3 autonomy/classify.py classify <paths>`.
5. **CI** (security lane): run `pytest tests/autonomy` in the Python job of
   `ci.yml`. The gate workflow does not run the tests itself.
6. **Labels** (hardening script): create `model-promotion`,
   `strategy-promotion`, `tier:t2`, `tier:t3`, `agent-approved:risk-auditor`,
   `agent-approved:code-reviewer`.
7. **PR template** (contributor lane): a line showing the autonomy tier
   reported by the gate.
8. **GLOSSARY.md** (contributor lane): T0-T3, auto-merge tier, circuit breaker.

## Differences from the prompt

Each item below is where current docs or the bootstrap spec contradict the
autonomy spec, or where the spec leaves a gap. Phase A takes the cautious
reading.

1. **Learned sections as T0.** The classifier works per path and cannot tell a
   Learned-only edit of a CLAUDE.md from any other edit. Bootstrap phase 5 also
   requires human review of knowledge PRs. So every `CLAUDE.md` is T2 (default).
   Making Learned sections T0 would need a diff-content check. That is
   deferred, not planned.
2. **Scorecards and outcomes live in `autonomy/`.** The spec calls weekly
   scorecards (`autonomy/scorecards/`) T0 and writes outcomes to
   `autonomy/outcomes/`. It also makes anything in `autonomy/` T3, never
   auto-merged. Phase A follows the stricter rule. **Human decision needed
   before Phase D/E:** move these stores outside `autonomy/` (for example
   `docs/reports/scorecards/`), or accept that they are T3.
3. **T1 categories.** Tests, flaky-test quarantine, Dependabot patch bumps and
   skill wording need author or content checks that do not exist yet. Only
   `docs/**/*.md` doc fixes are T1 now. With T1 auto-merge off they still need
   one human, so T1 and T2 behave the same today.
4. **Agent reviews are labels in Phase A.** The risk-auditor review that T3
   requires is shown by the label `agent-approved:risk-auditor` until Phase B
   gives the agent a bot identity that can leave a real review.
5. **The gate workflow runs from the PR.** Under `pull_request`, GitHub runs
   the PR's copy of the workflow. The gate reads its policy and classifier from
   the base branch, but a PR could still edit `autonomy-gate.yml` itself. That
   file is covered by CODEOWNERS review and the T3 requirement, not by the gate
   alone. Only the PR that first adds `classify.py` uses the PR's own
   classifier, because main has none yet. That PR touches `autonomy/`, so it
   is T3 either way.
6. **Two humans and one maintainer.** Today @SatyamDave is the only human with
   write access, so no T3 PR can pass the gate, including this one. That is the
   cautious reading of spec rule 4. **Human decision needed:** add a second
   maintainer, or accept an explicit, recorded admin override for T3 until
   then.
7. **T0 auto-merge vs required reviews.** The bootstrap hardening requires a
   CODEOWNERS review on every PR to main. That blocks T0 zero-human merges. Phase B
   needs a ruleset bypass for the autonomy GitHub App, limited to PRs the gate
   reports as T0, or T0 stays manual.
8. **Pausing is T3.** `autonomy/PAUSE` sits under `autonomy/`, so adding it
   needs two humans. Pausing should be easy, so `just autonomy-pause` sets the
   `AUTONOMY_ENABLED` repo variable first; that takes effect at once. The
   PAUSE file is the durable record.
9. **Extra protected paths.** Beyond the spec's list, Phase A also marks as T3:
   `.github/CODEOWNERS`, `tests/autonomy/**`, `tests/hooks/**` and
   `.claude/agents/risk-auditor.md`. Each controls who approves or proves a
   safety check. `ml/registry/` is left out of T0 because a model registry entry
   can move a champion.
10. **Scheduling.** The spec allows native scheduling if it fits. It does not
    fit yet (ADR-0006): routine PRs carry the owner's GitHub identity, and
    routines have no per-run budget.
