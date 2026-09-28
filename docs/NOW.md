# NOW  (updated: 2026-09-28, `main` at `013f3b1`)

Status: [docs/reports/base-status.md](reports/base-status.md). ADR-0040:
[docs/adr/0040-agentic-decision.md](adr/0040-agentic-decision.md). Milestones:
[ROADMAP](ROADMAP.md#a0-a7-the-agentic-pipeline-blocked-on-human-decisions).

## Where we are
- [x] M0 offline foundation met 2026-09-28; ADR-0040 written, Accepted by Satyam only.
- [x] A1 Handoff contract and A2 Evals met (fake/replay mode; `just agent-sim`, `just eval` green).
- [x] A3 Broker: approval/cancel/reconcile/kill-file/heartbeat built, mock-Robinhood-tested.
- [ ] Rohit hasn't reviewed ADR-0040 or the two waves that merged today (#56-#61, #72-#87) — a
      dated exception, not a precedent ([TEAM.md](TEAM.md#review-and-the-enforcement-gap)).
- [ ] A4 (real data + classifier) onward: not started.

## Next steps — Satyam
1. Get Rohit's review of both merged waves and his approval of ADR-0040 (#20).
2. Request counsel review: Robinhood consent/personal-use, Anthropic high-risk-use (#24).
3. Decide the first asset (#21) and spend caps (#23) jointly with Rohit; `spy.toml` is a
   placeholder, not a decision.

## Next steps — Rohit
1. Review the two merged waves (risk, bridge v1.2.1, gateway, evals, ops, latency, recorder,
   learning loop) — flag anything to revert before A4.
2. Connect a real Robinhood account read-only to learn tool schemas (#26) and rate limits (#27) —
   the mock scaffold in `agent/src/broker/` is waiting on this.
3. Once #21/#26 land: build the real (non-mock) network adapter on the existing gateway.

## Blockers (human decisions, not code)
1. Rohit's approval of ADR-0040 and of the two build waves (#20).
2. Counsel review (#24); DSR promotion threshold (#22); spend caps (#23); first asset (#21).
3. A real Robinhood account for #26/#27 — nothing in A3 can finish without it.
4. Second-approval / GitHub-plan gap (#25): still unresolved, still relied on as an exception.

## Not now
Real Robinhood connection, live agent decisions (`QC_AGENT_MODE=live`), shadow, the first agentic
trade (A4-A6), venue adapters for the engine vertical, autonomy loops, decision layer and Jev,
L0-L3 learning, RD-Agent/qlib, sops encryption, metric ratchet, second vertical, UI.
Reasons: [ROADMAP](ROADMAP.md#deferred).

Owners: Satyam (@SatyamDave) and Rohit (@rovivek); ownership split proposed in [TEAM.md](TEAM.md), not yet confirmed by Rohit.
