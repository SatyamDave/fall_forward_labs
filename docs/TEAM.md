# Team

Who works on quant-core, who owns what, how work is handed over, and which decisions are open.
Updated 2026-09-27. Draft for both founders to edit; the process spec is
[docs/specs/0006-team.md](specs/0006-team.md) as amended by
[docs/specs/0007-research-loop.md](specs/0007-research-loop.md) §8.

## People

| Person | GitHub | Status | Evidence |
|---|---|---|---|
| Satyam Dave | @SatyamDave | Confirmed. Repository owner and the only collaborator. | `gh api repos/SatyamDave/fall_forward_labs/collaborators` lists one login, 2026-09-27 |
| Second founder | UNKNOWN | Not identified in any file, PR or collaborator list. | Nothing to cite |

No document in this repository should name, describe or assign work to the second founder until
they add themselves here in their own PR.

## Ownership

Every area has one confirmed owner today. The backup column stays empty until a second person is
confirmed.

| Area | Paths | Primary | Backup |
|---|---|---|---|
| Engine core, replay | `engine/crates/{core,orderbook,oms,gateway,strategy-runtime,replay}` | @SatyamDave | none |
| Risk and limits (protected) | `engine/crates/risk/`, `config/limits/` | @SatyamDave | none |
| Research and ML | `research/`, `ml/`, `data/`, `backtest/` | @SatyamDave | none |
| Claude configuration (settings and hooks protected) | `.claude/`, `CLAUDE.md` files | @SatyamDave | none |
| CI and security (workflows protected) | `.github/`, `scripts/`, `SECURITY.md` | @SatyamDave | none |
| Autonomy policy (protected) | `autonomy/` | @SatyamDave | none |
| Docs and process | `docs/`, `README.md`, `CONTRIBUTING.md` | @SatyamDave | none |

## Handoffs

There is no handoff hook yet (team spec Phase 3 is not built). Until it is, a session checkpoints
by hand:

1. Update [docs/NOW.md](NOW.md) if the milestone, next task or blockers changed.
2. In the PR body (or a PR comment), write what changed, what was actually run and its result,
   and the exact next runnable command.
3. Push the branch. Personal memory files and local notes are not a handoff; the repository is.

Simultaneous work uses separate branches or git worktrees, one per task.

## Review and the enforcement gap

What the rules ask for: protected-zone changes need human approval, loosening a risk limit needs
two human approvals (root rules 3 and 4), and autonomy T3 needs two humans (#3).

What the platform enforces today: nothing. Checked 2026-09-27:

- Branch protection and rulesets return HTTP 403 "Upgrade to GitHub Pro or make this repository
  public" on this private, user-owned repository. No check is required and `main` accepts a direct
  push from the owner.
- GitHub does not let a PR author approve their own PR. Every PR so far is authored by
  @SatyamDave, so with one collaborator no PR can receive any approving review, and with two
  collaborators a founder-authored PR can receive at most one.
- CODEOWNERS requests a review from the listed owner. It cannot require a count, and it does
  nothing without a branch rule that requires code-owner review.
- `.claude/hooks/guard-protected.sh` (#11) blocks protected edits only inside Claude Code sessions
  started with that settings file. It does not bind humans, other tools or CI.

Proposed policy, for both founders to accept or change (nothing here is applied):

1. Until a second founder is a collaborator, no PR touching a protected zone merges. The owner
   records the decision to merge ordinary PRs in the PR itself.
2. Once the second founder is added, a protected-zone PR merges only with an approving review from
   the founder who did not author it, on the latest commit, and a written risk review in the PR.
   "Two approvals" for rule 4 then means author plus the other founder, stated explicitly, since
   GitHub cannot count the author.
3. Make it enforceable by moving the repository to an organization or plan where rulesets work,
   then requiring the CI checks, code-owner review, and dismissal of stale approvals.
4. No bot, GitHub App or automation account is added as a reviewer or given a bypass.

## Open decisions

| Decision | Blocks | Where |
|---|---|---|
| Second founder identity and GitHub handle | Two-person review, backup owners | this file |
| Operators' jurisdiction and entity | Venue choice, any account | ADR-0003 (#5), ADR-0020 (#9) |
| First vertical: kalshi-events or crypto perps | Vertical adapter, specialization milestone | ADR-0020 (#9), ADR-0003 (#5) |
| Accept or revise ADRs 0001-0005 | Toolchain pin, registry, engine dependency | #5 |
| GitHub plan or organization for rulesets | Any enforced review or required check | this file |
| Whether to add `ANTHROPIC_API_KEY` | AI review and knowledge-loop workflows (paid calls) | #13, #10 |
| Founders' agreement (IP, roles) | Anything beyond research; outside the repo | team spec, human checklist |
