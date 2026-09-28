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

## qc-bridge: an externally-triggered switch that works even if the agent is stuck (#44)

`qc_replay::Engine` above has no trigger outside the process. `qc-bridge` (`engine/crates/bridge/`,
the live/agent-facing engine, ADR-0040) does, as of protocol v1.2, and this is the manual procedure
for tripping it:

1. **File trigger (works even if the agent process is dead or hung).** Start `qc-bridge` with
   `--kill-file <path>`, then from an operator shell: `touch <path>` (contents are never read, only
   existence). The bridge polls this path on every record it processes and every op it dispatches —
   whatever is still alive and sending the bridge *anything* discovers it, so this does not depend
   on the agent's cooperation. `tests/chaos.rs`
   (`kill_file_halts_within_one_second_and_cancels_every_open_order`) proves the 1-second bound
   **given that something keeps calling the bridge during the outage** — the test's own loop does
   this by polling directly.
   **Requirement this crate cannot satisfy by itself (wave-2 review finding):** nothing in the
   stack today actually provides that "something," independent of the agent's own decision loop.
   `agent/src/loop.ts`'s reconcile calls are decision-count-based (tied to the loop making
   progress, not a wall-clock timer), and `ops/live/supervisor.py` only reacts to process *exit*,
   not to a live-but-unresponsive loop. **A real deployment needs a process that calls `status`
   (or any op) on a genuine wall-clock interval, independent of whether the decision loop is
   making progress** — until one exists, `--kill-file` only reliably trips within one second while
   the decision loop itself keeps calling the bridge; a fully stalled feed with a hung decision
   loop delays observation until something else touches the bridge.
2. **In-band trigger.** If something can still send the bridge a line on its stdin (the gateway, a
   manual `qc-bridge` session), send `{"v":1,"op":"kill","reason":"<why>","id":"<any>"}`. Same
   effect, immediate instead of polled.
3. Both engage the same shared `KillSwitch` a plain external `engage()` call would (root rule 11),
   and both then run the same one-way `halt`: refuse every new `submit_order_intent`, and cancel
   every open order (`SimVenue` in `sim` mode; `PendingCancel` in `external` mode, for the gateway
   to finish against the real venue — the same "confirm cancels in the venue's own view" step below
   still applies, since this process alone cannot confirm a real fill or cancel).
4. Everything after tripping the switch is the same as the plain procedure below: confirm, decide on
   positions, notify, don't restart blind, write it up.

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

`qc-bridge` (`engine/crates/bridge/src/eventlog.rs`, protocol v1.2) now writes one JSON object per
line to stderr on every halt, kill-switch engagement, risk reject, reconcile result and accepted
intent, matching `scripts/ops/alerts.py`'s contract exactly (one snake_case vocabulary, not two):
`{"ts_ns", "event": "halt", "reason": "kill_switch"|"max_daily_loss"|"reconciliation"|
"illegal_order_event", "detail"?}` and `{"ts_ns", "event": "kill_switch_engaged", "source":
"file"|"op"}` for the externally-triggered switch above (fires before the bridge's next message
would otherwise observe the halt). `alerts.py` raises a generic **halt** alert for any `event:
"halt"` line, and a narrower **kill_switch** alert specifically for `reason == "kill_switch"` or a
`kill_switch_engaged` line; both fire from the same trigger. See `ops/live/README.md` for where the
log file lives and how the alert checker runs, `scripts/ops/alerts.py`'s module docstring for the
full contract, and `tests/ops/test_bridge_alerts_contract.py` for the real-binary proof that the
bridge's own stderr output actually drives `alerts.py`'s rules end to end.
