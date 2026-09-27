# NOW  (updated: 2026-09-27)

Process: docs/process/research-cycle.md. Audit: docs/audits/0001-reality-audit.md.

## Current milestone: M0
Bootstrap merged and the first research cycle recorded.
- [ ] Bootstrap PRs merged in their stated order (#5, #1, then #7, #11, #10, #8, phases 4, 6, 8)
- [ ] `just check` green on `main`
- [ ] research/0001 recorded: registration, baseline, manifest, and a decision (reject is fine)

## Next task
Finish research/0001 (`research/0001-favorite-longshot`): one registered test of one mechanism
against a baseline on Kalshi data, as a candidate market only.

## Blockers (human decisions)
1. Operators' jurisdiction and entity; first vertical (ADR-0020 vs ADR-0003).
2. Second founder's identity and GitHub handle. T3 two-approval cannot pass with one maintainer (#3).
3. Branch protection needs a GitHub plan that allows it on a private repo (API returns 403).
4. Repository secrets (`ANTHROPIC_API_KEY`) if the knowledge loop should run (#10).
5. Research or compute budget. None is configured, so work stays local, paid calls off.

## Deferred (not M0)
Autonomy loops, decision layer and Jev, L0-L3 learning, RD-Agent/qlib sandbox, 30-100 task eval
suite, plugin marketplace, managed settings, sops encryption, metric ratchet, second vertical,
live trading, UI. Reasons: docs/audits/0001-reality-audit.md.

Owners: Satyam (`@SatyamDave`) · second founder: unknown
