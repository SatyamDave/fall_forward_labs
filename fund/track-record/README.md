# fund/track-record

Protected zone. Append-only daily PnL records reconciled against venue statements, with the reconciliation scripts and their outputs. Records are never edited retroactively.

## Daily P&L report format (issue #70, `just report-pnl`)

`scripts/reports/pnl_report.py` writes one file per day to `fund/track-record/daily/<YYYY-MM-DD>.json`.
Each file is written once and never edited afterward: rerunning for a date whose file already
exists is a no-op if the content is byte-identical, and a hard error otherwise — a past day's
number does not change after the fact (root CLAUDE.md rule 10).

**Source, honestly labelled.** `source` is `"decision_ledger_estimate"` today: it reads the agent's
own decision ledger (`out/agent/ledger.jsonl`), not a reconciled venue statement, because issue #45
(daily reconciliation against Robinhood's own reported state) does not exist yet. Every fill is an
*assumption* (an accepted buy/sell decision, filled in full at its own `limit_price`), not a real
venue execution price. `source` becomes `"reconciled"` once a report is built from #45's output
instead — nothing else in this format needs to change shape when that happens.

Fields:

| Field | Meaning |
|---|---|
| `date` | The trading day this record is for (UTC). |
| `source` | `"decision_ledger_estimate"` (see above) or, once #45 exists, `"reconciled"`. |
| `entry_count` | Number of decision-ledger entries the report was computed from. |
| `agent` | `realized_pnl_usd`, `fees_paid_usd`, `unrealized_pnl_usd`, `total_pnl_after_fees_usd` — average-cost accounting, decimal strings, fees always realized immediately. |
| `no_trade` | `total_pnl_usd`, always `"0"`: the do-nothing baseline. |
| `buy_and_hold` | Same shape as `agent`, sized to the agent's peak position and entered at the first ledger entry's mid — or `null` if the agent never took a position to size the baseline against (no arbitrary size is invented). |
| `max_drawdown_usd` | Cumulative peak-to-trough decline in the agent's equity curve, to date. |
| `ai_cost_usd` | Sum of every entry's `cost_usd` (the model-call cost, not a trading fee). |
| `stop_rule` | `triggered`, `reasons`, `thresholds`, and `thresholds_source`. Thresholds are read from `scripts/reports/pnl_policy.toml` and are **placeholder values pending founders' decision #23** until both founders sign off in writing (issue #70's Done-when) — a `"triggered": false` result is not itself that sign-off. |

`just report-pnl` exits nonzero when the stop rule trips, so it can gate a scheduled job the same
way any other check does.
