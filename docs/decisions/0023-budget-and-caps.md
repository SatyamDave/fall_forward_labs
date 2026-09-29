<!--
This is a decision packet, not a sign-off. It lays out the options and a recommendation for the
founders to read and decide. It is not signed, and it does not itself change any config, ADR, or
gate. See docs/decisions/README.md for the list of packets and their status.
-->

# Canary funding, per-order/daily caps, and stop-rule thresholds (#23)

Related issue: [#23](https://github.com/SatyamDave/fall_forward_labs/issues/23) — "Agree how much
money we're willing to lose."

## Why this has to be a real number, not a platform setting

Robinhood's Agentic account has **no configurable spending cap at all** on the platform side.
Confirmation of a trade is instruction-based, not a toggle: *"if you've asked your agent to take
action without asking your approval, it can place trades without your confirmation"*
(`robinhood-agentic-mcp.md` §3, quoting Robinhood's own support docs). Once an order reaches
Robinhood from an authenticated agent session, it is *"final and binding"* (Customer Agreement
§29.8, same file). That means every dollar limit in this project has to live in our own risk layer
— `engine/crates/risk/` and `config/limits/*.toml` — not at the broker. `config/limits/default.toml`
already says this in its own comment: *"Robinhood's agentic accounts have no platform-side
spending cap, so this is the only enforcement."*

## Founder stated funding: $50 (2026-09-28)

A founder stated on 2026-09-28 that the Robinhood Agentic account is funded with **$50 total**,
and that this is the whole budget. The old placeholders let one day spend $2,000 and set the stop
rule at the entire $50 account, so the caps were tightened to fit (tighten-only, root rule 4):

| Field | File | Was | Now |
|---|---|---|---|
| `max_notional` (per order) | `config/limits/default.toml` (canary's `limits`), `config/limits/spy.toml` | $500 | $25 |
| `max_daily_notional` | same two files | $2,000 | $50 |
| `max_daily_loss` | same two files | $100 | $5 |
| `max_drawdown_usd` (stop rule) | `scripts/reports/pnl_policy.toml` | $50 | $5 (10% of the account) |

Every other key is unchanged. This note records a stated fact and the tightened numbers; it is not
the founders' sign-off, and `fund/compliance/signoffs/budget-caps.md` still does not exist.

One consequence: with $50 the agent cannot buy even one share of SPY with the whole-share limit
orders it sends, so the first asset (#21) has to be a lower-priced ETF, chosen from live quotes in
a follow-up. The table below is the state before this note.

## What's already in the code (placeholders, not decisions)

| Field | File | Current value | Status |
|---|---|---|---|
| `max_notional` (per order) | `config/limits/default.toml`, `config/limits/spy.toml` | $500 | Default, marked "deliberately tiny" |
| `max_position` | `config/limits/default.toml` (0.01 BTC) / `config/limits/spy.toml` (10 shares) | — | Default |
| `max_order_rate_per_sec` | both | 5 | Default |
| `max_daily_loss` | both | $100 | Trading halts at this loss |
| `max_daily_notional` (cumulative accepted notional/day) | both | $2,000 | **Explicitly "pending #23" in the file's own comment** — this issue |
| `wash_trade_window_ms` | both | 2000 ms | Default |
| `real_orders` | `config/environments/canary.toml` | `true` | This environment places real orders once funded |
| `order_types_allowed` | `config/environments/canary.toml` | `["limit"]` only | Locked for this milestone |
| `kill_switch_max_ms` | `config/environments/canary.toml` | 1000 ms | Global kill switch must respond within this |
| `fee_bps` (assumed execution cost) | `scripts/reports/pnl_policy.toml` | 10 bps | Placeholder, "no real fee schedule to read here yet" |
| `max_drawdown_usd` (stop rule) | `scripts/reports/pnl_policy.toml` | $50 | **Explicitly a placeholder pending #23** |
| `max_consecutive_days_behind_buy_and_hold` (stop rule) | `scripts/reports/pnl_policy.toml` | 5 days | **Explicitly a placeholder pending #23** |

Two things worth noting about these numbers as they stand today:

1. `config/limits/default.toml` and `spy.toml`'s `max_daily_notional = "2000"` is annotated
   "pending #23 (the founders' actual agreed number)" — this is a placeholder in the same file the
   task asked to keep consistent with, not a hidden default to work around.
2. `scripts/reports/pnl_policy.toml`'s stop-rule numbers are explicitly *not* the real, approved
   stop rule: its own header says issue #70's done-when is *"The stop rule is written down and
   approved by both founders before the first trade happens"* and warns *"do not treat a 'not
   triggered' result as founders' sign-off."* This packet's recommendation below is not that
   sign-off either — it is input to it.

## What's missing: total canary funding, and a separate, smaller starter-phase cap

Nothing in the repository currently states a **total dollar amount** funded into the agentic
account, or a **starter-phase cap** smaller than the steady-state canary default. Issue #23 asks
for both explicitly.

## Options

**A. Adopt the existing placeholders as the real numbers.** Total funding somewhat above the
$2,000 daily-notional cap (so the account isn't immediately capital-constrained), per-order cap
$500 (matches `max_notional` already in both limit files), daily cap $2,000, stop-rule drawdown
$50. Simplest option — turns a placeholder into a decision with the least new numbers to agree on.
Risk: the $2,000/$50 pair implies the strategy can lose the entire stop-rule drawdown in one bad
day at a fraction of the daily notional cap, which may be tighter or looser than the founders
actually intend — it was chosen as "a small multiple of max_notional," not from a founders'
conversation about actual risk tolerance.

**B. Adopt the existing numbers as the *steady-state* canary cap, and add a materially smaller
starter-phase cap for the first N days/trades.** For example: per-order cap $100 (not $500) and
daily notional cap $500 (not $2,000) for the first two weeks or first 10 filled orders, then step
up to the existing $500/$2,000 defaults once the kill switch, replay determinism, and reconciliation
have been observed working against real fills. This directly answers issue #23's "a smaller
starter-phase cap" requirement and gives the founders a live proof point before the full canary
cap is live. Risk: more numbers to track, and a second future decision (when to step up) that
needs its own dated record — though tightening in the interim needs no approval (root rule 4), only
loosening back up does.

**C. Set materially different numbers from what's in the code today.** Founders may simply want a
different total risk budget than "a small multiple of $500." Nothing in the repository or research
argues for a specific total beyond "deliberately tiny" — this is a founder risk-tolerance choice,
not a technical one, and this packet does not invent a number to present as decided.

## Recommendation

Option B: keep the existing $500 per-order / $2,000 daily-notional defaults as the steady-state
canary numbers (they are already wired into `config/limits/default.toml` and `spy.toml`, already
consistent with `config/environments/canary.toml`'s `limits = "config/limits/default.toml"` pointer,
and already described as "deliberately tiny"), but add an explicit, smaller starter-phase cap for
the first stretch of real trading, stepped up only after the founders see the kill switch and
reconciliation work against real fills. For the stop rule, the existing $50 max-drawdown / 5-day
placeholder in `pnl_policy.toml` is a reasonable starting point precisely because it is already a
small multiple of the per-order cap, but it needs the founders' own read on how much total loss is
acceptable before it can be called "approved" rather than "not yet triggered."

**Total funding amount is a founder decision this packet cannot recommend a specific number for** —
it should be set high enough that the daily-notional cap isn't the very first thing that blocks a
trade, and no higher than an amount both founders are equally willing to lose entirely, per
`robinhood-agentic-mcp.md`'s point that any authenticated-agent instruction is final and binding.

## Files that would change if this is accepted (not changed by this packet)

- `config/limits/default.toml` and `config/limits/spy.toml` — `max_daily_notional`'s "pending #23"
  comment would be resolved (either kept at $2,000 or changed), and a starter-phase override added
  if option B is chosen (likely a new `config/limits/canary-starter.toml` or an additional field —
  no such file exists yet).
- `docs/adr/0040-agentic-decision.md` and/or a dedicated ADR — records the founders' dated
  agreement, per issue #23's acceptance criteria ("Numbers recorded in
  `docs/adr/0040-agent-in-the-loop.md` (or a dedicated ADR) and in `config/limits/default.toml` /
  a new `config/limits/agentic.toml`").
- `scripts/reports/pnl_policy.toml` — the stop-rule placeholders become the approved numbers (or
  are replaced), and its header comment's "NOT the real, approved stop rule" caveat is removed only
  once both founders' approval is actually on file, per issue #70's done-when.
- `fund/compliance/signoffs/budget-caps.md` — the dated, human-written sign-off record
  `scripts/ops/preflight.py` checks for before real orders are allowed (see
  `fund/compliance/signoffs/README.md`); this packet is not that record and does not create it.
- The total funding amount itself is not stored in any config file found in this repository —
  accepting this packet would need a decision on where that number is recorded (most likely the
  same ADR, since it isn't a risk *limit* enforced by code the way the per-order/daily caps are).

---

# Budget and caps sign-off (#23)

Related issue: #23

Decision: <what was actually decided, in plain language -- total funding amount, per-order cap,
daily cap, and the starter-phase cap, not "looks good">

Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
