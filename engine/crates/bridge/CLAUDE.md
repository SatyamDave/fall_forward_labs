# engine/crates/bridge — qc-bridge: JSON Lines stdio bridge to an external decision agent

## Owns / does not own
- Owns: protocol v1.1 wire parsing and dispatch (`src/wire.rs`), the bridge's
  own engine loop (`src/engine.rs`): feed → book → features → signal on one
  side, risk → OMS → `SimVenue`/`report_execution` on the other, and approval
  token minting/verification (`src/approval.rs`, issue #34). Binary `qc-bridge`.
- Does not own: the schemas (`schemas/decision/v1/`, ADR-0040, versioned separately),
  the TypeScript agent service (`agent/`, not yet built) and its
  `agent/src/broker/` gateway (the approval-token *verifier*: this crate only
  mints), risk limit values (`config/limits/`), the venue adapter itself (`qc-gateway`),
  `RiskContext` construction (owned by the risk lane; only changes where the
  context struct itself changes).

## Commands
- `cargo test -p qc-bridge --locked`
- `cargo clippy -p qc-bridge --all-targets --locked -- -D warnings`
- `cargo deny check` (workspace-wide; required whenever a dependency changes)
- `just bridge` (release binary), `just check`
- `qc-bridge <recording> [--venue sim|external] ...` — `sim` (default) is v1-compatible; `external` never routes to `SimVenue` (see `schemas/decision/v1/README.md`).

## MUST
- Every response line echoes the request's `v`/`id` and validates against
  `schemas/decision/v1/*.schema.json` (tested in `tests/schema_conformance.rs`
  with the `jsonschema` crate, pinned exact, dev-dependency only).
- `submit_order_intent` runs kill switch → the same `qc_risk::RiskEngine`
  checks `qc_replay::Engine` runs → OMS → `SimVenue` (`sim` mode) or a signed
  `approval` and no routing (`external` mode); an order that fails any check
  never reaches the OMS or the venue (`tests/risk_rejection.rs`).
- `report_execution` (`external` mode only) applies a gateway-reported event
  to the OMS through the same `apply_order_event` fill bookkeeping
  `drain_venue_events` uses; an illegal transition is never applied and
  engages the kill switch instead of being silently skipped
  (`tests/external_mode.rs`).
- No wall clock: time comes only from recorded timestamps via `qc_core::SimClock`,
  including `report_execution`'s `ts_ns` (`SimClock::advance_to` is monotonic-safe).
  Two scripted runs over the same recording give byte-identical stdout in
  `sim` mode (`tests/determinism.rs`); a fresh Ed25519 keypair per process
  means an `external`/`hello` session is deliberately *not* held to that bar.
- Stdout carries only protocol response lines; every log goes to stderr.
- `ed25519-dalek` stays pinned exact (`=X.Y.Z`); any bump needs a fresh
  `cargo deny check` pass, not just a build.

## NEVER
- No `HashMap`/`HashSet` (clippy.toml bans them; record order must stay deterministic).
- Never route an order that failed a risk check, even when the bridge itself
  is otherwise a thin pass-through to the agent's decision.
- Never route an order in `external` venue mode; only `report_execution`
  (from the gateway, after it talks to the real venue) may move it forward.
- The `jsonschema` dev-dependency stays a dev-dependency and keeps
  `default-features = false`: schemas resolve `$ref`s from an in-memory
  `Registry` built from the committed files, never HTTP or filesystem resolution.
- `venue_order_id` on the `report_execution` wire is a decimal-integer string
  (`qc_core::VenueOrderId` is a `u64` newtype) — this is UNVERIFIED against a
  real broker's actual order-id format until #26; the assumption lives in
  exactly one place, `wire::parse_venue_order_id`.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- `schemas/decision/v1/README.md` (protocol v1.1: `hello`, `--venue`,
  approval tokens, `report_execution`), `docs/adr/0040-*.md` (agentic trading
  handoff), `../replay/src/lib.rs` (the risk/OMS/venue path this crate's
  `submit_order_intent` mirrors), `src/approval.rs` (the one approval-token
  implementation, also exported as `schemas/decision/v1/approval-test-vector.json`
  for the TS gateway).
