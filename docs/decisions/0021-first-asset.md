<!--
This is a decision packet, not a sign-off. It lays out the options and a recommendation for the
founders to read and decide. It is not signed, and it does not itself change any config, ADR, or
gate. See docs/decisions/README.md for the list of packets and their status.
-->

# First asset: US ETF vs. crypto (#21)

Related issue: [#21](https://github.com/SatyamDave/fall_forward_labs/issues/21) — "Pick what the
agent trades first."

## The question

Which instrument does the agentic trading loop trade first: a liquid US ETF (for example SPY) or
a crypto pair? This is the asset for the *agentic-account learning loop* (ADR-0040) specifically —
it is separate from the still-open first-vertical choice for the classifier/engine work
(Kalshi event contracts vs. crypto perps, tracked in ADR-0003/ADR-0020 and `docs/TEAM.md`'s open
decisions table), which this packet does not touch.

## Costs (per round trip, ignoring price movement)

| | Liquid ETF (e.g. SPY) | Crypto (Robinhood default routing) |
|---|---|---|
| Commission | $0 for US listed equities/ETFs | $0 line-item commission |
| Regulatory/exchange fees | Sub-cent on a small order: Reg Fee $20.60 per $1,000,000 of principal (sell leg only), FINRA TAF $0.000195/share capped at $9.79, CAT Fee $0.000003/share | None documented separately |
| Spread/PFOF cost | Not separately billed; Robinhood earns payment for order flow from market makers (its own explainer cites ~$0.0023/share in the quarter it covered) — this is inside the execution price, not a charge to you | ~$0.95 per $100 of notional **each way** under default spread-based routing, as of June 2026 |
| Illustrative $500 round trip | Near-zero in explicit fees; the real cost is the bid/ask spread | ~$4.75 (0.95% × 2) |

Sources: `RHF Fee Schedule (revised 2026-09-17)` and the crypto order-routing figures, both quoted
in `robinhood-agentic-mcp.md` §5 (this session's scratchpad research file, reusing a same-day
primary-source read from `robinhood-research.md` §5, citing Robinhood's `rhc-fee-schedule.pdf` and
its crypto-order-routing help article). Bottom line stated in that file: "for the founders'
minimal-money, many-round-trips design, equities/ETFs are structurally far cheaper per round trip
than crypto under Robinhood's default crypto routing — roughly 1% each way vs. basis-point-level
cost on a liquid ETF."

**Caveat, flagged in the research as unresolved:** which fee regime an Agentic-account
`place_crypto_order` call actually gets (the default spread-based routing above, or the separate,
cheaper tiered exchange fees the standalone Crypto Trading API offers) is not stated anywhere in
Robinhood's Agentic Trading docs. Treat the $0.95/$100 figure as the applicable one until Robinhood
documents otherwise (`robinhood-agentic-mcp.md` §5, "UNVERIFIED which fee regime applies to
Agentic MCP crypto orders specifically").

## Trading hours and settlement

- **ETF (equities):** regular market hours only. `config/instruments/spy.toml` already encodes
  this: `09:30`–`16:00` `America/New_York`, Monday–Friday. Long-only in the Agentic account (no
  margin borrowing yet), and a cash account waits one business day (T+1) for sale proceeds to
  settle before re-trading them, unless the account is upgraded to limited margin, which removes
  the wait but still does not enable borrowing (`robinhood-agentic-mcp.md` §3, quoting Robinhood's
  own disclosures).
- **Crypto:** trades roughly 24/7 with immediate settlement of sale proceeds
  (`robinhood-research.md` §3, quoting Robinhood's settlement help article), which is a real
  advantage for a loop that wants many round trips per day.

## What the code already supports today

- `config/instruments/spy.toml` exists: symbol `SPY`, whole-share lots, cent tick size, the NYSE
  trading-hours block above, and its own `config/limits/spy.toml` (max 10 shares/order, $500 max
  notional, $100 max daily loss, $2,000 max daily notional — placeholders pending issue #23). The
  file's own header comment is explicit that this is scaffolding, not a decision: *"Placeholder
  symbol 'SPY', asset pending #21 (the founders' actual first-asset decision) — this file exists so
  the engine can speak a real US-equity-shaped instrument... not to declare SPY the chosen asset."*
- `config/limits/default.toml` is shaped for crypto instead (`max_position` in base units like
  "0.01 BTC"), so it is not evidence either way — it predates this decision and is the generic
  fallback.
- `config/venues/` currently holds only a `README.md`; no venue adapter exists yet for either
  asset class, so neither path is more "built" than the other at the venue-connection layer.
- `docs/adr/0040-agentic-decision.md` Challenge 5 already recommends a liquid ETF as the default
  first asset for the agentic-account learning loop, "unless 24/7 market access outweighs it,"
  and defers the actual pick to the founders in A0.

## Risks

- **ETF:** market-hours-only cuts the number of round trips per day, which matters for a
  many-round-trips learning loop; the Agentic MCP's exact order-type list (market/limit/stop) for
  `place_equity_order` is not published (`robinhood-agentic-mcp.md` §2, "UNVERIFIED beyond the
  general statement"), though `config/environments/canary.toml` already restricts this build to
  limit orders only regardless of asset.
- **Crypto:** materially higher fees per round trip (above), and the same wash-trade/self-cross
  risk applies to both asset classes under `config/limits/default.toml`'s
  `wash_trade_window_ms` and the ADR-0040 gateway design — crypto's faster trading cadence means
  more opportunities to trip it.
- **Both:** no Robinhood sandbox or paper-trading environment exists for either asset class
  (`robinhood-agentic-mcp.md` §7); learning has to happen offline (replay) or against small amounts
  of real money regardless of which asset is chosen.

## Recommendation

A liquid ETF (SPY, matching the existing `config/instruments/spy.toml` scaffold) as the first
asset, for three reasons: it is roughly 20–40x cheaper per round trip than crypto's default
routing at small sizes, it is what ADR-0040 already recommends, and it is what the config already
has a placeholder for — picking it turns that placeholder into a real decision rather than
building a second, unused instrument config for crypto. The tradeoff being accepted is fewer
round trips per day (market hours only) in exchange for the loop's edge not being eaten by fees
before it can be measured.

This is a recommendation, not a decision. Issue #21's own done-when criteria still apply: the
choice needs to be written down with its cost math (this packet, plus the ADR), recorded in the
venue config (not just a doc), and dated with both founders' agreement.

---

# First asset sign-off (#21)

Related issue: #21

Decision: <what was actually decided, in plain language -- the exact instrument or pair, not
"looks good">

Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
Approved by: <Full Name> (@<github-handle>) — <YYYY-MM-DD>
