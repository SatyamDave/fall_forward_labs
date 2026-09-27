# Runbook: kill switch

Status 2026-09-27: nothing trades, so this runbook describes what the kill switch does in the
simulated engine (#15) and what a live procedure still lacks. Owner: @SatyamDave.

## What exists

`qc_risk::KillSwitch` (`engine/crates/risk/src/lib.rs`) is a shared `Arc<AtomicBool>`. Any thread
holding a clone can call `engage()`. There is no reset; clearing it means restarting the process.

When it is engaged, `qc_replay::Engine` (`engine/crates/replay/src/lib.rs`):

1. Notices on the next record it processes (`check_kill_switch`) or when risk rejects an order
   with `RiskReject::KillSwitch`, and records `halt KillSwitch` in the order log.
2. Refuses every new order: risk rejects them, and the engine drops any command after the halt.
3. Sends a cancel request to the venue for every working order that is not already pending cancel.

What it does not do:

- It does not wait for or verify the cancels. The OMS keeps each order in `PendingCancel` until
  the venue answers, and `halt()` ignores a cancel that fails to send (for example while
  disconnected). SimVenue answers every cancel while connected, so the chaos test ends with 0 open
  orders; a real venue could lose or refuse a cancel and leave a working order.
- It does not flatten or hedge positions. Inventory stays as it was.
- It is not engaged by anything outside the process: there is no operator command, endpoint or
  file flag.
- It is checked per record, so the one-second bound (root rule 11) depends on records arriving.
  The chaos test `kill_switch_from_another_thread_halts_within_one_second`
  (`engine/crates/replay/tests/chaos.rs`) engages it from another thread and asserts the halt
  within 1 s and no submission after it; it runs in `cargo test`, and CI runs that only on #13's
  branch today.

Other halt reasons with the same effect (no new orders, cancel requests): `IllegalOrderEvent`,
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
