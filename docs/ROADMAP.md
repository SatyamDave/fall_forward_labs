# Roadmap

Updated 2026-09-27. What must be true for an offline engineering foundation, what the first
specialization adds, and what is deferred and why. Current state is in
[docs/reports/base-status.md](reports/base-status.md); the week-to-week view is
[docs/NOW.md](NOW.md).

## M0: offline engineering foundation (current)

An identified, reproducible checkout on `main` that either founder can set up, check, and use to
run one genuine offline end-to-end fixture demo, with its interfaces, limits and unfinished work
written down. It needs no venue, no credentials and no paid service.

Definition of done:

- [ ] The bootstrap PRs are merged into `main` in the order in [base-status](reports/base-status.md#merge-sequence),
      with conflicts resolved by a human.
- [ ] `just setup` and `just check` exit 0 on a fresh clone of `main`, and CI (`ci.yml`) passes
      on `main`.
- [ ] `just replay` reproduces the same order-log hash twice on the committed fixture.
- [ ] `just walkforward demo` runs end to end and writes its report and registry rows to a known
      place (it may, and on synthetic data does, end in FAIL).
- [ ] Interfaces, risk checks and kill-switch behavior documented as built
      ([ARCHITECTURE](ARCHITECTURE.md), [kill-switch runbook](runbooks/kill-switch.md)).
- [ ] Known defects recorded with owners: the unreachable deflated-Sharpe gate, the SimVenue fill
      limits, the unenforced review rules.
- [ ] Study 0001 recorded with a decision (REJECT and INSUFFICIENT EVIDENCE are acceptable).

M0 does not require L0-L3 learning, autonomy loops, the decision layer, a live track record,
multi-agent services or a chosen venue.

## M1: first specialization (blocked on human decisions)

Starts only after the operators' jurisdiction is known and ADR-0020 or ADR-0003 is accepted.

1. Accept the first vertical and record venue eligibility for the operators.
2. Point-in-time data capture for that venue with the quality checks in `data/quality/`.
3. A venue adapter behind `VenueAdapter`, tested against recorded fixtures and the venue's demo
   environment only.
4. Fill and cost model calibrated to the venue; replace the SimVenue shortcuts for anything that
   claims execution quality.
5. Forward shadow evaluation of whatever survives research, with no orders.

Live trading, even limited, is a separate decision after M1 and needs explicit human
authorization.

## Deferred

| Item | Reason | Revisit when |
|---|---|---|
| NautilusTrader, hftbacktest (ADR-0001) | Proposed only; the custom `qc-*` crates are what run. LGPL needs legal review | ADR-0001 is decided |
| MLflow (ADR-0005) | JSONL registry is enough for one study | Trial volume or lineage needs outgrow JSONL |
| Autonomy loops B-H (#3) | Need breakers, an App token, a second approver | M0 merged and review is enforceable |
| Decision layer and Jev (#4) | No call site has a measured need; distillation blocked by MCA §2.3(b) | A call site shows a measured need |
| L0-L3 learning (#2) | Needs a validated signal and labels | A signal survives forward shadow |
| RD-Agent, qlib sandbox | Multiplies trials before one baseline exists | After study 0001 and one more cycle |
| Agent eval suite | Build from the first workflow's real failures | Failures are logged |
| sops/age encryption, plugin marketplace, managed settings | No threat model; plans unknown | Threat model written |
| Metric ratchet | Replaced by invariants plus justified tolerances (research-loop §8) | Not planned |
| Second vertical | Scope rule: one implementation | First vertical has a reconciled record |

## History: the Final Base "base complete" checklist

Preserved from [docs/specs/0005-final-base.md](specs/0005-final-base.md) Phase 5. Status as of
2026-09-27 in brackets.

- ADR-0020 and ADR-0021 human-approved [0020 Proposed, 0021 not written]
- Audit complete, cuts in ROADMAP with code removed [audit in #14, no code removed]
- Core contracts implemented once, no vertical code in core [partial: `qc-*` traits, no `Instrument`/`MarketFamily`]
- Vertical adapter tests pass against demo; replay determinism on vertical data [not started; replay on synthetic data only]
- End-to-end paper trading in demo with full risk engine, kill switch tested [not started; `just paper` refuses]
- Slow-signal path rejects stale, unsigned, over-influence; leakage-flagged features blocked [not started]
- L0-L3 run for the vertical in shadow or offline with demotion tested [not started]
- Autonomy loops within budget, weekly cost report [not started]
- Security green, zero High/Critical on `main`, hardening script run [CI passes on #17 and #8, nothing on `main`; hardening blocked by plan]
- Fresh-clone test to a passing PR without asking [not run]
- CLAUDE.md within budget, `/context` evidence, no references to removed paths [budgets met; `/context` not run]

### Proposed correction (for review, not adopted)

The checklist mixes an offline foundation with a live vertical, learning and autonomy. Proposal:
call M0 above "foundation ready" and use it as the only gate for building on the base; move the
vertical, paper-in-demo and slow-signal items to M1; move L0-L3 and autonomy to the deferred table;
never tag `v0.1.0-base` or write a "base complete" report until the M0 boxes are checked on `main`.
Both founders accept or amend this in the PR that merges this file.
