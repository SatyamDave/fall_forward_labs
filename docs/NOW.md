# NOW  (updated: 2026-09-27, audited `0cf6c2c`)

Status: [docs/reports/base-status.md](reports/base-status.md). Process: [docs/process/research-cycle.md](process/research-cycle.md).
Replaces the NOW.md drafts in #6 and #14; the founders confirm or edit it when merging.

## Milestone M0: offline engineering foundation ([ROADMAP](ROADMAP.md))
- [ ] PRs #1-#17 and #8 reviewed and merged into `main` in the base-status merge sequence
- [x] `just setup` and `just check` exit 0 with every suite, and CI passes, at `0cf6c2c` (not yet on `main`)
- [x] `just replay` deterministic; `just walkforward demo` leaves the tree and registry untouched
- [ ] Devcontainer built once (not run: no docker)
- [x] Study 0001 recorded: INSUFFICIENT EVIDENCE (#16); reproduces only from an off-git snapshot

## Next steps (in dependency order)
1. Review and merge the PRs in the base-status sequence, then #17, then #8.
2. Apply the protected patches in `docs/proposals/` after their approvals; 0002 before any API key.
3. Register study 0001 v2 as a new trial with a population bounded by series or category.

## Blockers (human decisions)
1. Operators' jurisdiction and first vertical (ADR-0020 vs ADR-0003). Vertical: PENDING.
2. Second founder's identity and GitHub handle.
3. A GitHub plan or organization where branch protection and rulesets work (API returns 403).
4. An approved shared store for study data, and a check of Kalshi's data terms (UNVERIFIED).
5. Redefine the deflated-Sharpe gate in `strategies/_template/GATES.md`.
6. Research or compute budget: none configured, so work stays local and paid calls stay off.

## Not now
Live or paper trading, venue adapters, autonomy loops, decision layer and Jev, L0-L3 learning,
RD-Agent/qlib, sops encryption, metric ratchet, second vertical, UI. Reasons: [ROADMAP](ROADMAP.md#deferred).

Owners: Satyam (@SatyamDave), all areas · second founder: UNKNOWN ([TEAM](TEAM.md))
