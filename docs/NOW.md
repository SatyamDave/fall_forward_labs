# NOW  (updated: 2026-09-27)

DRAFT — both founders edit this before it's real. See docs/plans/0006-team.md
for the reasoning behind each line and the open questions.

Vertical: PENDING ADR-0020 (kalshi-events proposed; crypto perps per ADR-0003)
Scope rule: general interfaces, one implementation

Current milestone: M0 — bootstrap merged and base audit complete

Definition of done:
- [ ] bootstrap-lane PRs merged (#1 skeleton, #2 self-learning phase 1, #3 autonomy phase A)
- [ ] `just check` green on main
- [ ] ADR-0020 (first vertical) decided by both founders
- [ ] repo hardening applied (branch protection, CODEOWNERS, secret scanning)

This week's priorities (ranked):
1. Decide ADR-0020 (first vertical) so downstream phases can stop branching on PENDING
2. Merge open bootstrap-lane PRs (#1, #2, #3) in the order each PR's body states
3. Add Founder B as a GitHub collaborator (unblocks T3 two-human approvals; see PR #3 decision 1)

Not now (do not work on):
- second vertical, new venues
- live trading
- UI
- autonomy loops enabled (POLICY.yaml ships with enabled: false until Phase H breakers exist)

Open decisions needing both founders: ADR-0020 (first vertical), ADR-0030
(managed settings adoption — depends on which Claude plan each founder is
on), ADR-0031 (plugin marketplace adoption) — see docs/plans/0006-team.md

Owners: Satyam (@SatyamDave): TBD areas · Founder B: TBD
