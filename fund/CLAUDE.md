# fund/ — track record and compliance (PROTECTED ZONE)

## Owns / does not own
- Protected (root rule 3): every change needs human approval.
- Owns: track-record/ (append-only daily PnL, reconciliation scripts and their outputs), compliance/ (compliance records).
- Does not own: live PnL calculation (engine), venue statements (fetched by reconciliation, not stored as raw data here), marketing.

## Commands
- Edits to existing records: `git diff --diff-filter=MD --name-only origin/main -- track-record` prints nothing

## MUST
- PnL is reconciled daily against venue statements; each day's record includes the reconciliation output (root rule 10).
- Records are append-only: new files or appended lines only (check above).
- A reconciliation mismatch is recorded as-is with an incident link, never smoothed.
- Investor-facing content gets legal review before it is shared.

## NEVER
- Never edit or delete a past record (check above).
- Agents never write investor-facing content alone; a human authors or signs off, named in the PR.
- No performance claims or return targets outside reconciled records.
- No credentials or account numbers (root rule 2).

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- Rule: .claude/rules/risk-guard.md; docs/runbooks/; SECURITY.md
