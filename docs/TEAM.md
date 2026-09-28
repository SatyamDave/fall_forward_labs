# Team

Who works on quant-core, who owns what, how work is handed over, and which decisions are open.
Updated 2026-09-28. Draft for both founders to edit; the process spec is
[docs/specs/0006-team.md](specs/0006-team.md) as amended by
[docs/specs/0007-research-loop.md](specs/0007-research-loop.md) §8.

## People

| Person | GitHub | Status | Evidence |
|---|---|---|---|
| Satyam Dave | @SatyamDave | Confirmed. Repository owner. | `gh api repos/SatyamDave/fall_forward_labs/collaborators`, 2026-09-27 |
| Rohit | @rovivek | Assumed from the collaborator list — **confirm**: `gh api repos/SatyamDave/fall_forward_labs/collaborators` now lists two logins, `SatyamDave` and `rovivek`, but `rovivek` has not yet added themselves to this file, and no PR in the repository is authored by that login as of this update. Treat the name "Rohit" and the ownership split below as the docs lane's working assumption, not a confirmed fact, until Rohit edits this row themselves. | `gh api repos/SatyamDave/fall_forward_labs/collaborators` lists `rovivek`, checked 2026-09-27 |

No document in this repository should name, describe or assign work to a second founder beyond
what this file states, until they add themselves here in their own PR.

## Ownership

The engine/research/CI split below predates ADR-0040 and is unchanged. The agentic-pipeline split
is proposed by [ADR-0040](adr/0040-agentic-decision.md) and the coordinator's build-lane spec
(2026-09-28); **Rohit has not yet confirmed it** — treat the "Primary" column for the new rows as
assumed, same caveat as the People table above.

| Area | Paths | Primary | Backup |
|---|---|---|---|
| Engine core, replay | `engine/crates/{core,orderbook,oms,gateway,strategy-runtime,replay}` | @SatyamDave | none |
| Risk and limits (protected) | `engine/crates/risk/`, `config/limits/` | @SatyamDave | none |
| Research and ML | `research/`, `ml/`, `data/`, `backtest/` | @SatyamDave | none |
| Claude configuration (settings and hooks protected) | `.claude/`, `CLAUDE.md` files | @SatyamDave | none |
| CI and security (workflows protected) | `.github/`, `scripts/`, `SECURITY.md` | @SatyamDave | none |
| Autonomy policy (protected) | `autonomy/` | @SatyamDave | none |
| Docs and process | `docs/`, `README.md`, `CONTRIBUTING.md` | @SatyamDave | none |
| **Agentic: bridge, `qc-bridge`, approval-token protocol, Robinhood Agentic MCP gateway adapter, external kill switch, reconciliation** | `engine/crates/bridge/`, `schemas/decision/`, `agent/src/broker/` (gateway shell) | @rovivek (assumed — confirm) | @SatyamDave |
| **Agentic: agent service, prompts, decision-schema consumer, eval suite and workflow, decision-ledger analysis, Robinhood account/legal/counsel liaison** | `agent/` (TypeScript, minus `src/broker/`), `evals/`, `scripts/eval/`, `tests/evals/` | @SatyamDave | none |
| **Agentic: shared data recorder, classifier on real data, shadow/canary review** | `data/recorders/`, `ml/` (real-data path) | Shared (both approve) | — |

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

What the platform enforces today: nothing. Checked 2026-09-28:

- Branch protection and rulesets return HTTP 403 "Upgrade to GitHub Pro or make this repository
  public" on this private, user-owned repository. No check is required and `main` accepts a direct
  push from the owner.
- GitHub does not let a PR author approve their own PR. Every PR so far is authored by
  @SatyamDave, so with one collaborator no PR can receive any approving review, and with two
  collaborators a founder-authored PR can receive at most one.
- CODEOWNERS requests a review from the listed owner (the catch-all now comes first, so the
  protected-path lines win). It cannot require a count, and it does nothing without a branch rule
  that requires code-owner review.
- `.claude/hooks/guard-protected.sh` (#11) blocks protected edits only inside Claude Code sessions
  started with that settings file. It does not bind humans, other tools or CI.

Dated exception, 2026-09-28: on the owner's explicit instruction, PRs #1-#7 and #9-#17 were
merged, including protected-zone (T3) changes, with the second human approval **waived by the sole
founder**. Agent reviewers left COMMENT reviews, which are not approvals. This records a human
decision; it is not enforcement and not a precedent. Details:
[base-status](reports/base-status.md#how-the-prs-were-merged).

Dated exception, 2026-09-28 (second batch): on the owner's explicit instruction ("merge
everything"), PRs #56, #58, #59, #60 and #61 were merged. They include ADR-0040, which amends root
rule 1 (the agent may make the final trade decision), protected workflow files and
`autonomy/POLICY.yaml`. Rohit (@rovivek) had not reviewed them: his approval of ADR-0040 is still
required by the decision protocol above and is tracked in issue #20. Until he approves, treat
ADR-0040 as accepted by Satyam only; nothing beyond fake-mode and simulated trading may run.

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
| Rohit's confirmation of the @rovivek handle and the agentic ownership split above | Two-person review, backup owners, ADR-0040 approval | this file |
| Operators' jurisdiction and entity | Venue choice, any account | ADR-0003 (#5), ADR-0020 (#9) |
| First vertical: kalshi-events or crypto perps | Vertical adapter, specialization milestone | ADR-0020 (#9), ADR-0003 (#5) |
| Accept or revise ADRs 0001-0005 (merged, still Proposed) | Toolchain pin (patch 0001), registry, engine dependency | `docs/adr/` |
| GitHub plan or organization for rulesets | Any enforced review or required check | this file |
| Whether to add `ANTHROPIC_API_KEY` and enable a loop in `autonomy/POLICY.yaml` | AI review and knowledge-loop workflows (paid calls, gated by `scripts/ci/ai_gate.py`) | `autonomy/POLICY.yaml` |
| Rohit's approval of ADR-0040 and the root CLAUDE.md rule 1 amendment | A2 onward; enabling `loop-agent-eval` | `docs/adr/0040-agentic-decision.md` |
| Counsel review: Robinhood consent/personal-use clauses; Anthropic's high-risk-use and no-training-on-outputs clauses | A0 closing; A6 first agentic trade | ADR-0040 Challenges 8-9 |
| First asset for the agentic account (ADR-0040 recommends a liquid ETF; not yet decided) | A0 closing, A4 data capture | ADR-0040 Challenges 5 |
| Founders' agreement (IP, roles) | Anything beyond research; outside the repo | team spec, human checklist |
