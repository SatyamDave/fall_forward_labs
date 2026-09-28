# Runbook: kill switch

Status 2026-09-28: nothing trades, so this runbook describes what the kill switch does in the
simulated engine (#15) and what a live procedure still lacks. Owner: @SatyamDave.

## What exists

`qc_risk::KillSwitch` (`engine/crates/risk/src/lib.rs`) is a shared `Arc<AtomicBool>`. Any thread
holding a clone can call `engage()`. There is no reset; clearing it means restarting the process.

When it is engaged, `qc_replay::Engine` (`engine/crates/replay/src/lib.rs`):

1. Notices on the next record it processes (`check_kill_switch`) or when risk rejects an order
   with `RiskReject::KillSwitch`, and records `halt KillSwitch` in the order log.
2. Refuses every new order: risk rejects them, and the engine drops any command after the halt.
3. Sends a cancel to the venue for every working order that is not already pending cancel, and
   sends again, on every later record, any cancel the venue could not take (for example while
   disconnected), until no order is open.

What it does not do:

- It does not confirm cancels beyond the venue's own answers. The OMS keeps each order in
  `PendingCancel` until the venue answers. SimVenue answers every cancel while connected, so the
  chaos test ends with 0 open orders; a real venue could still lose or refuse one.
- It does not flatten or hedge positions. Inventory stays as it was.
- It is not engaged by anything outside the process: there is no operator command, endpoint or
  file flag.
- It is checked per record, so the one-second bound (root rule 11) depends on records arriving.
  The chaos test `kill_switch_from_another_thread_halts_within_one_second`
  (`engine/crates/replay/tests/chaos.rs`) engages it from another thread and asserts the halt
  within 1 s and no submission after it; it runs in `cargo test` and in CI on `main`, but no check is
  required (branch protection is unavailable on this plan).

Other halt reasons with the same effect (no new orders, cancels): `MaxDailyLoss` (realized plus
unrealized loss reached the limit), `IllegalOrderEvent`,
`Reconciliation` (any discrepancy, including an unknown venue order) and `Runaway`.

## Procedure for a live process (planned, not available)

Blocked on a venue adapter and an operator trigger (M1, see [docs/ROADMAP.md](../ROADMAP.md)).
Until they exist, the steps below are the intended shape, not a working procedure.

1. **Trip the switch.** Planned: an operator command that engages `KillSwitch` in every engine.
   Without it, stop the process, which also stops the cancel requests from being sent.
2. **Confirm no new orders** in the venue's own order history, not only this repo's logs.
3. **Confirm cancels** in the venue's open-orders view. Cancel anything still working by hand.
4. **Decide on positions.** The switch never flattens; a human decides whether and how to reduce
   inventory, and records the choice and reason.
5. **Notify** by opening an issue from `.github/ISSUE_TEMPLATE/incident.yml`: what tripped it,
   when, what is still open.
6. **Do not restart** until the cause is understood and, if it touched a risk limit or protected
   zone, a human has approved resuming.
7. **Write it up** with `docs/postmortems/0000-template.md`. Every action item becomes a test, a
   rule or a runbook change.

## Alerting (#64)

This section is about `qc-bridge` (`engine/crates/bridge/`), the live/agent-facing engine (ADR-0040)
-- a separate binary from `qc_replay::Engine` above, though both share `qc_risk`'s `KillSwitch` and
`RiskEngine`. `qc-bridge` has no structured event log yet; `scripts/ops/alerts.py`'s contract asks
for one JSON object per line, reusing the same snake_case vocabulary its `submit_order_intent`
wire result already uses (`risk_reject_code()` and the `halted` field in
`engine/crates/bridge/src/engine.rs`): `{"ts_ns", "event": "halt", "reason":
"kill_switch"|"max_daily_loss"|"reconciliation"|"illegal_order_event", "detail"?}` (the last two
are anticipated from protocol v1.1's `report_execution`, not yet implemented). It raises a generic
**halt** alert for any `event: "halt"` line, and a narrower **kill_switch** alert specifically when
`reason == "kill_switch"` (or a future `event: "kill_switch_engaged"` line, for the externally
triggered switch in #44, which may fire before the bridge's next message observes the halt). Both
fire from the same log line. See `ops/live/README.md` for where the log file lives and how the
alert checker runs, and `scripts/ops/alerts.py`'s module docstring for the full contract.
