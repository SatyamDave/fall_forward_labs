# NOW  (updated: 2026-09-28, `main` at `9f39eee`)

Status: [docs/reports/base-status.md](reports/base-status.md). Process: [docs/process/research-cycle.md](process/research-cycle.md).

## Milestone M0: offline engineering foundation ([ROADMAP](ROADMAP.md))
- [x] PRs #1-#7 and #9-#17 merged into `main` (2026-09-28); #8 (these docs) merges last
- [x] `just setup` and `just check` exit 0 on a clean clone of `main`; CI green on `9f39eee`
- [x] `just replay` matches the committed order-log hash; `just walkforward demo` leaves the tree clean
- [x] Study 0001 recorded: INSUFFICIENT EVIDENCE (reproduces only from an off-git snapshot)
- [ ] Devcontainer built once (not run: no docker)

## Next steps (in dependency order)
1. Register study 0001 v2 as a new trial, with the population sized by metadata-only calls first.
2. Move to a GitHub plan or organization where rulesets work, so review can be enforced.
3. Add the second founder as a collaborator and in [TEAM.md](TEAM.md).
4. Decide ADR-0001, ADR-0004 (then apply `docs/proposals/0001-rust-toolchain-pin.patch`), ADR-0005.
5. Decide the deflated-Sharpe threshold in `strategies/_template/GATES.md`.

## Blockers (human decisions)
1. Operators' jurisdiction and first vertical (ADR-0020 vs ADR-0003). Vertical: PENDING.
2. An approved shared store for study data, and a check of Kalshi's data terms (UNVERIFIED).
3. Research or compute budget: none configured, so work stays local and paid calls stay off.

## Not now
Live or paper trading, venue adapters, autonomy loops, decision layer and Jev, L0-L3 learning,
RD-Agent/qlib, sops encryption, metric ratchet, second vertical, UI. Reasons: [ROADMAP](ROADMAP.md#deferred).

Owners: Satyam (@SatyamDave), all areas · second founder: UNKNOWN ([TEAM](TEAM.md))
