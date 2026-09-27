# NOW  (updated: 2026-09-27)

Status: [docs/reports/base-status.md](reports/base-status.md). Process: [docs/process/research-cycle.md](process/research-cycle.md).
Replaces the NOW.md drafts in #6 and #14; the founders confirm or edit it when merging.

## Milestone M0: offline engineering foundation ([ROADMAP](ROADMAP.md))
- [ ] Bootstrap PRs merged into `main` in the base-status merge sequence
- [ ] `just setup` and `just check` exit 0 on a fresh clone of `main`; CI passes on `main`
- [ ] `just replay` deterministic on `main`; `just walkforward demo` runs without touching committed records
- [ ] Known defects recorded with owners (DSR gate, SimVenue limits, unenforced review)
- [x] Study 0001 recorded with a decision: INSUFFICIENT EVIDENCE (#16)

## Next steps (in dependency order)
1. Fix the candidate's red `just check`: drop the `# noqa: S311` in #16 and point it at `research/registry/log/`.
2. Merge #5, #1, then the stack per base-status; pick this NOW.md over #6 and #14.
3. Register study 0001 v2 as a new trial with a population bounded by series or category.

## Blockers (human decisions)
1. Operators' jurisdiction and first vertical (ADR-0020 vs ADR-0003).
2. Second founder's identity and GitHub handle.
3. A GitHub plan or organization where branch protection and rulesets work (API returns 403).
4. Whether to add `ANTHROPIC_API_KEY`: four workflows would then make paid calls regardless of `autonomy/POLICY.yaml`.
5. Redefine the deflated-Sharpe gate in `strategies/_template/GATES.md`.
6. Research or compute budget: none configured, so work stays local and paid calls stay off.

## Not now
Live or paper trading, venue adapters, autonomy loops, decision layer and Jev, L0-L3 learning,
RD-Agent/qlib, sops encryption, metric ratchet, second vertical, UI. Reasons: [ROADMAP](ROADMAP.md#deferred).

Owners: Satyam (@SatyamDave), all areas · second founder: UNKNOWN ([TEAM](TEAM.md))
