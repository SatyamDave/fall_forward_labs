# NOW  (updated: 2026-09-28, `main` at `9f39eee`)

Status: [docs/reports/base-status.md](reports/base-status.md). ADR-0040 (agentic decision):
[docs/adr/0040-agentic-decision.md](adr/0040-agentic-decision.md).

## Milestone A0/A1: agentic decision (ADR-0040) ([ROADMAP](ROADMAP.md#a0-a7-the-agentic-pipeline-blocked-on-human-decisions))
- [x] M0 offline foundation met 2026-09-28 (kept, unchanged)
- [x] ADR-0040 written and Accepted by Satyam 2026-09-28
- [ ] Rohit's approval of ADR-0040 (root CLAUDE.md rule 1 amendment needs both founders)
- [ ] `agentic/bridge`, `agentic/agent-service`, `agentic/evals`, `agentic/claude-md` PRs merged
- [ ] `just agent-sim` green with a deterministic ledger hash (A1 exit test)

## Next steps (in dependency order)
1. Get Rohit's review and approval on ADR-0040 — nothing past A1 proceeds without it.
2. Request counsel review: Robinhood consent/personal-use clauses, Anthropic's high-risk-use and
   no-training-on-outputs clauses (ADR-0040 Challenges 8-9).
3. Set up the agentic Robinhood account (A0) once counsel and the first-asset decision land.
4. Decide the first asset for the agentic account (ADR-0040 recommends a liquid ETF; founders
   decide) — separate from the still-open engine/classifier vertical (ADR-0020 vs ADR-0003).
5. Merge the four `agentic/*` lane PRs, then register study 0001 v2 and the ADR-0001/0004/0005 pins.

## Blockers (human decisions)
1. Rohit's approval of ADR-0040 (blocks A2 onward, and the root CLAUDE.md rule 1 amendment).
2. Counsel: Robinhood API/MCP consent and personal-use clauses; Anthropic Usage Policy's
   financial-decisions clause and the no-training-on-outputs restriction.
3. Agentic account setup and funding amount (blocks A0 closing, then A6).
4. First asset for the agentic account, and separately, operators' jurisdiction and the
   engine/classifier vertical (ADR-0020 vs ADR-0003). Both: PENDING.
5. Research or compute budget: none configured; `loop-agent-eval` stays disabled, zero budget.

## Not now
Live agent decisions (`QC_AGENT_MODE=live`), the Robinhood adapter, shadow, the first agentic trade
(A3, A5, A6), venue adapters for the engine vertical, autonomy loops, decision layer and Jev, L0-L3
learning, RD-Agent/qlib, sops encryption, metric ratchet, second vertical, UI.
Reasons: [ROADMAP](ROADMAP.md#deferred).

Owners: Satyam (@SatyamDave) and Rohit (@rovivek, confirmed as a collaborator, ownership split not
yet recorded per area — see [TEAM](TEAM.md)).
