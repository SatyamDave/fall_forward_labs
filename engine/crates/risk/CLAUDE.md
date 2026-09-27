# engine/crates/risk — qc-risk: pre-trade risk checks and limits (PROTECTED ZONE)

## Owns / does not own
- Protected (root rule 3): every change needs human approval and risk-auditor review. Limits may be tightened automatically, loosened only with two human approvals (root rule 4).
- Owns: `Limits` (serde, `deny_unknown_fields`), `RiskContext`, `RiskReject`, the `RiskCheck` trait and its implementations: max position, max notional, max order rate, max daily loss, fat-finger price band, stale-data halt, kill switch.
- Does not own: limit values (`config/limits/*.toml`, also protected), order state (qc-oms), sending orders (qc-gateway).

## Commands
- `cargo test -p qc-risk --locked`
- `cargo clippy -p qc-risk --all-targets --locked -- -D warnings`
- `just replay` and `just check` before requesting review

## MUST
- `RiskCheck::check` runs before every order; no code path reaches `VenueAdapter::submit` without it. Check: tests/integration covers it, and `grep -rn 'submit(' ../ --include='*.rs'` shows each call behind a check.
- Every limit has tests at the boundary: exactly at the limit, one tick inside, one tick over. Check: one test per `RiskReject` variant, `grep -c 'RiskReject::' src/lib.rs`.
- The kill switch is checked first and wins over every other result.
- Market data older than `stale_data_ms` rejects with `StaleData`.
- Unknown keys in a limits file fail to parse (`deny_unknown_fields` stays).
- Every PR here requests risk-auditor review and states which limits changed and in which direction.

## NEVER
- No bypass flag, feature, or env var that skips checks in production builds. Check: `grep -rnE 'cfg\(feature|skip_risk|bypass_risk|RISK_BYPASS' src` prints nothing.
- Never loosen a limit default or widen a check to make a test pass; stop and report instead.
- Never remove `deny_unknown_fields`. Check: `grep -n deny_unknown_fields src/lib.rs` has a hit.
- No floats in limit math. Check: `grep -rnwE 'f32|f64' src | grep -v '//'` prints nothing.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- Rule: .claude/rules/risk-guard.md; agent: .claude/agents/risk-auditor.md
- config/limits/default.toml, strategies/_template/GATES.md, tests/chaos/ (kill switch)
