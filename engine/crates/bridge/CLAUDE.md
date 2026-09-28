# engine/crates/bridge — qc-bridge: JSON Lines stdio bridge to an external decision agent

## Owns / does not own
- Owns: protocol v1 wire parsing and dispatch (`src/wire.rs`), the bridge's own
  engine loop (`src/engine.rs`): feed → book → features → signal on one side,
  risk → OMS → `SimVenue` on the other. Binary `qc-bridge`.
- Does not own: the schemas (`schemas/decision/v1/`, ADR-0040, versioned separately),
  the TypeScript agent service (`agent/`, not yet built), risk limit values
  (`config/limits/`), the venue adapter itself (`qc-gateway`).

## Commands
- `cargo test -p qc-bridge --locked`
- `cargo clippy -p qc-bridge --all-targets --locked -- -D warnings`
- `just bridge` (release binary), `just check`

## MUST
- Every response line echoes the request's `v`/`id` and validates against
  `schemas/decision/v1/*.schema.json` (tested in `tests/schema_conformance.rs`
  with the `jsonschema` crate, pinned exact, dev-dependency only).
- `submit_order_intent` runs kill switch → the same `qc_risk::RiskEngine`
  checks `qc_replay::Engine` runs → OMS → `SimVenue`, in that order; an order
  that fails any check never reaches the OMS or the venue (`tests/risk_rejection.rs`).
- No wall clock: time comes only from recorded timestamps via `qc_core::SimClock`.
  Two scripted runs over the same recording give byte-identical stdout
  (`tests/determinism.rs`).
- Stdout carries only protocol response lines; every log goes to stderr.

## NEVER
- No `HashMap`/`HashSet` (clippy.toml bans them; record order must stay deterministic).
- Never route an order that failed a risk check, even when the bridge itself
  is otherwise a thin pass-through to the agent's decision.
- The `jsonschema` dev-dependency stays a dev-dependency and keeps
  `default-features = false`: schemas resolve `$ref`s from an in-memory
  `Registry` built from the committed files, never HTTP or filesystem resolution.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- `schemas/decision/v1/README.md`, `docs/adr/0040-*.md` (agentic trading handoff),
  `../replay/src/lib.rs` (the risk/OMS/venue path this crate's `submit_order_intent` mirrors)
