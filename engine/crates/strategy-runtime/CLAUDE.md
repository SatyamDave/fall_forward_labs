# engine/crates/strategy-runtime — qc-strategy-runtime: Strategy trait and the event loop that drives it

## Owns / does not own
- Owns: the `Strategy` trait (`on_event(&mut self, &Event, &OrderBook, &mut Vec<Command>)`) and its `Command` enum, the loop that feeds events in order and hands requests to risk and the OMS, kill-switch propagation to strategies.
- Does not own: strategy logic (strategies/<name>/), risk checks (qc-risk), replay harness (qc-replay).

## Commands
- `cargo test -p qc-strategy-runtime --locked`
- `cargo clippy -p qc-strategy-runtime --all-targets --locked -- -D warnings`
- `just replay` after any change to event ordering or dispatch

## MUST
- Same events in the same order produce the same requests; `just replay` proves it (root rule 7).
- Strategies write into the caller's `out` buffer; the loop clears and reuses it.
- Every request a strategy emits goes through `RiskCheck::check` before the OMS sees it.
- The loop honors the global kill switch within one second (root rule 11); tests/chaos covers it.
- Time reaches strategies only through events or a `Clock`, so replay can drive it.

## NEVER
- No wall-clock reads, randomness, or thread scheduling that changes output order. Check: `grep -rnE 'SystemTime|Instant::now|rand::|thread::spawn' src` prints nothing.
- No allocation per event on the loop. Check: `grep -rnE 'Vec::new|Box::new|format!' src` has no hit outside `#[cfg(test)]`.
- No AI or network calls from strategies or the loop (root rule 1).

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- strategies/CLAUDE.md, engine/crates/replay, tests/replay/, .claude/rules/rust-hotpath.md
