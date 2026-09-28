# engine/crates/bridge — qc-bridge: JSON Lines stdio bridge to an external decision agent

## Owns / does not own
- Owns: protocol v1.2 wire parsing and dispatch (`src/wire.rs`), the engine
  loop (`src/engine.rs`: feed → book → features → signal; risk → OMS →
  `SimVenue`/`report_execution`), approval minting (`src/approval.rs`, order
  + cancel, issue #34/#66), the structured stderr event log
  (`src/eventlog.rs`, issue #64/#44), instrument/trading-hours config
  (`src/instrument.rs`, issue #66). Binary `qc-bridge`.
- Does not own: the schemas (`schemas/decision/v1/`, ADR-0040), the TS agent
  service and its `agent/src/broker/` gateway (the approval *verifier* and
  the piece that finishes a real-venue cancel/reconcile), risk limit
  *values* (`config/limits/`, `config/instruments/`), the venue adapter
  (`qc-gateway`), `RiskContext` construction (risk lane).

## Commands
- `cargo test -p qc-bridge --locked`; `cargo clippy -p qc-bridge --all-targets --locked -- -D warnings`
- `cargo deny check` (workspace-wide; required whenever a dependency changes)
- `just bridge` (release binary), `just check`
- `qc-bridge <recording> [--venue sim|external] [--kill-file <path>] [--instrument <path.toml>] ...`
  — no `--kill-file`/`--instrument` is byte-for-byte v1.1 (`schemas/decision/v1/README.md`).

## MUST
- Every response validates against `schemas/decision/v1/*.schema.json` (`tests/schema_conformance.rs`).
- `submit_order_intent` order: kill switch → reconcile gate (`external`) →
  instrument checks (tick/qty-step/trading-hours) → `qc_risk::RiskEngine` →
  OMS → `SimVenue` or a signed approval; any failed check never reaches the
  OMS/venue (`tests/risk_rejection.rs`, `instrument.rs`, `reconcile.rs`).
- `report_execution` applies a gateway event through `apply_order_event`; an
  illegal transition halts with reason `illegal_order_event`, never applied (`tests/external_mode.rs`).
- Halting (`BridgeEngine::halt`, one-way) always cancels every open order:
  routed to `SimVenue` in `sim`, `PendingCancel` in `external` for the
  gateway to finish (`tests/kill_and_cancel.rs`, `chaos.rs`).
- `--kill-file` is polled on every record *and* op (`process_record`, top of
  `wire::handle_line`), so it works even if the agent never sends another
  line — `tests/chaos.rs` proves the 1-second budget.
- `external` mode refuses `submit_order_intent` until a `reconcile` finds no
  discrepancy (`"unreconciled"`); a discrepancy halts as `reconciliation` (`tests/reconcile.rs`).
- `cancel_order_intent` never checks `self.halted` (risk never blocks a
  cancel); unknown/terminal id is `invalid_cancel`, never a silent no-op.
- No wall clock: time comes only from recorded timestamps via `SimClock`
  (incl. `report_execution.ts_ns`). Two scripted runs give byte-identical
  stdout in `sim` mode (`tests/determinism.rs`); a fresh Ed25519 keypair per
  process means `external`/`hello` is deliberately not held to that bar.
- Stdout is protocol-only; every log (incl. the new structured event log)
  goes to stderr, matching `scripts/ops/alerts.py`'s one vocabulary.
- `ed25519-dalek` stays pinned exact; any bump needs a fresh `cargo deny check`.

## NEVER
- No `HashMap`/`HashSet` (clippy.toml bans them; record order must stay deterministic).
- Never route an order that failed a risk check.
- Never route an order in `external` mode; only `report_execution` may move it forward.
- `jsonschema` stays a dev-dependency, `default-features = false` (in-memory `Registry` only).
- `venue_order_id` (`report_execution`/`reconcile`) is a decimal-integer
  string (UNVERIFIED until #26; one place, `wire::parse_venue_order_id`).
- `instrument::Tz` never grows a hand-rolled DST rule for a zone this repo
  doesn't need — a third zone needs a real tz crate, not another `match` arm.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- `schemas/decision/v1/README.md` (v1.2: `market_ts_ns`, `kill`,
  `cancel_order_intent`, `reconcile`, `--kill-file`, `--instrument`),
  `docs/adr/0040-*.md`, `docs/runbooks/kill-switch.md` (trigger + alerting),
  `../replay/src/lib.rs` (`HaltReason` this crate mirrors), `src/approval.rs`
  (also exported as `approval-test-vector.json`), `scripts/ops/alerts.py`
  (the structured-log contract).
