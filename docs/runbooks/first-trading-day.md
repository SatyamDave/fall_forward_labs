# Runbook: first trading day (2026-09-29)

The founder's exact commands for the morning of the first shadow run and the first live canary
trade: one stock under $25, whole-share limit orders, caps from `config/limits/spy.toml` ($25 per
order, $50 per day, $5 daily loss). Owner: @SatyamDave.

Run everything from the repository root on the trading machine. Secret values go in the shell
environment only (or the secret manager, `ops/live/README.md`); never in a file in this repo, a
prompt, an issue or a PR.

## The night before

```
just agent-setup                 # pinned agent dependencies
just bridge                      # qc-bridge release binary
just bench-latency               # writes out/bench/latency-results.json (preflight latency gate)
(cd engine && cargo test --locked -p qc-bridge --test kill_file_watcher)   # build the kill-switch gate's test now, not at 09:30
just live-canary F --mock        # rehearsal: preflight on fixtures, then the whole chain on mocks
```

`--mock` must end with `canary mock passed` and exit 0. It never reads a real credential and
never connects anywhere but localhost.

## Sign-offs live trading needs (human edits, not tooling)

`just live-canary` refuses until every one of these exists:

1. `docs/adr/0040-agentic-decision.md` "## Status" records Rohit's approval.
2. `fund/compliance/signoffs/{asset,budget-caps,counsel,shadow-results,go-no-go}.md`, each from
   `TEMPLATE.md`, each with two dated `Approved by:` lines (Satyam and Rohit) and its own issue
   number (#21, #23, #24, #49, #51). `asset.md` and `go-no-go.md` name the chosen symbol.
3. `autonomy/POLICY.yaml` `loops.loop-agent-openrouter`: `enabled: true` and small positive
   numbers (for example `daily_usd 0.01, max_turns 1, timeout_minutes 1`). Protected; two
   approvals. The shadow run with `--decider openrouter` needs this too.

## Morning

Set the environment (values from the founder, typed into the shell, not saved in the repo):

```
export ROBINHOOD_MCP_URL=https://agent.robinhood.com/mcp/trading
export QC_ROBINHOOD_ACCOUNT_NUMBER=...     # the agentic account, never taken from get_accounts
export OPENROUTER_API_KEY=...
export QC_OPENROUTER_MODEL=...:free
```

1. Login check. `just preflight-live --decider openrouter` prints a `robinhood_signin` line; if
   it fails, run `just robinhood-login` and finish the sign-in in the browser.
2. Schema check: `just robinhood-schema-check --target real` (exit 0 means every tool and
   parameter we send matches the live server).
3. Probe prices (read-only): `just robinhood-probe-readonly --target real --symbols F,SOFI,NIO,PLTR`
   (up to 20 candidates). Pick one liquid stock whose last trade is under $25, so one share fits
   the $25 per-order cap.
4. Instrument file: `just new-equity-instrument F` (use the chosen symbol). It writes
   `config/instruments/f.toml` pointing at `config/limits/spy.toml`; commit it on a branch so the
   day's config is on record.
5. Shadow run (simulated orders only, real quotes):
   ```
   just shadow --decider openrouter --symbol F --request-budget 23400
   ```
   Output: `out/shadow/<date>/`. It runs until the recorder's budget is spent; Ctrl-C ends it and
   still writes the report. Stop it before step 7: two recorders would poll Robinhood twice as
   often, and its rate limit is unverified (#27).
6. Within 60 minutes of the live start, one read-only reconcile for preflight's
   `reconcile_recent` gate:
   ```
   just live-canary F --reconcile-only
   ```
7. Live canary, after the sign-offs above:
   ```
   just preflight-live --decider openrouter --instrument config/instruments/f.toml
   just live-canary F
   ```
   The first command only shows the gates; `just live-canary` runs the same gates itself and
   refuses (exit 1, starts nothing) if any fails, if a required variable is unset, or if
   `ops/live/state/KILL` or `ops/live/state/HALT` exists. It then runs the recorder, the
   supervisor (agent in openrouter mode, qc-bridge `--follow --venue external --instrument
   config/instruments/f.toml --kill-file ops/live/state/KILL --decide-every 900`) and the
   recording-stalled alert until the 16:00 ET close, then the daily close.

Where to look: `ops/live/logs/agent.log` (qc-bridge events and gateway lines),
`ops/live/logs/supervisor.log`, `out/live/<date>/heartbeat.jsonl`, `out/agent/ledger.jsonl`
(every decision), `out/agent/broker-journal.jsonl` (every order sent), and the day's record in
`fund/track-record/daily/`.

## How to stop

```
touch ops/live/state/KILL
```

Within one second qc-bridge refuses every new order and the agent's heartbeat cancels any open
order at Robinhood (`docs/runbooks/kill-switch.md`). Check `ops/live/logs/agent.log` for the
`kill_switch_engaged` and cancel lines, then press Ctrl-C to stop the processes. Positions are not
flattened; close one by hand in the Robinhood app if the founders decide to.

Restarting the same day: read why it stopped, remove `ops/live/state/KILL` (and
`ops/live/state/HALT` if the supervisor wrote one) by hand, run step 6 again, then step 7. Each
start records to a new file, so a restart never replays earlier quotes.

## Known limits

- An agent crash is not restarted (`--max-restarts 0`): the supervisor writes `HALT` and the run
  stops, because a restarted bridge would re-read the whole recording.
- While qc-bridge waits for the next decision (up to 900 records, about 15 minutes), it answers
  no other request, so the heartbeat logs `status check failed` timeouts. The kill file is still
  honored at once by the bridge's watcher thread; orders are only open during the 2 s emulated
  IOC window, when the bridge is responsive.
- The daily close reports reconciliation `unknown` and exits 1 until a `--reconcile-cmd` exists
  (`scripts/ops/daily_close.py`), so `just live-canary` exits 1 after a clean day too; read the
  printed `children_ok=` and `daily_close_exit=` values.
