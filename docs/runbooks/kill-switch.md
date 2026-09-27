# Runbook: kill switch

**Recognize.** Any of: a risk limit is breached and not auto-halting, a strategy is behaving
unexpectedly (unexpected order rate, unexpected side, unexpected size), a venue or data feed is
unreliable, or a human simply wants trading stopped now. Root rule 11: every live process must
honor the kill switch within one second — if it doesn't, that's the incident, not this one.

## Steps

1. **Trip the switch.**
   `TODO (engine-core phase, ops phase): exact command / endpoint for the global kill switch is
   not implemented yet. Until it exists, halting means killing the relevant strategy or gateway
   process directly and confirming no further orders are sent (step 3).`
2. **Confirm no new orders are being sent.** Check the venue's own order history / open-orders
   view, not just this repo's logs — the point of this step is catching the case where the
   switch itself didn't work.
3. **Decide on working orders.** Cancel-all is the default unless a human with context says
   otherwise (e.g. a resting order you want filled at a specific level). Record which you chose
   and why.
4. **Notify.** Post in the incident channel (or open a `.github/ISSUE_TEMPLATE/incident.md` issue
   if none exists yet) with: what tripped it, what time, what's still open.
5. **Do not restart** the halted strategy or process until the root cause is understood and, if it
   touched a risk limit or protected zone, a human has approved resuming.
6. **Write it up.** Use `docs/postmortems/0000-template.md`. Every action item becomes a test, a
   rule, or another runbook — an incident that doesn't produce at least one of those wasn't fully
   closed.

## Verify the switch itself works

This runbook is only as good as the switch it describes. `TODO (engine-core phase): CI test that
trips the kill switch and asserts halt latency < 1s (spec §12 acceptance checklist) does not
exist yet — until it does, this repo has a runbook but not a tested guarantee.`
