# engine/crates/gateway — qc-gateway: venue adapter trait, one module per venue

## Owns / does not own
- Owns: `VenueAdapter` trait (`submit`, `cancel`, non-blocking `poll`), `GatewayError`, one module per venue, rate limiting, reconnect with backoff, snapshot plus delta sync, venue message parsing.
- Does not own: order state (qc-oms), pre-trade checks (qc-risk), credentials storage (secret manager, ops/), venue choice (ADR-0003).

## Commands
- `cargo test -p qc-gateway --locked`
- `cargo clippy -p qc-gateway --all-targets --locked -- -D warnings`
- Fuzz a parser (nightly only, from engine/fuzz): `cargo +nightly fuzz run <venue>_parser`

## MUST
- Each venue is one module implementing `VenueAdapter`; nothing venue-specific leaks into the trait. Check: `grep -n 'mod ' src/lib.rs` lists one module per venue.
- Each adapter enforces the venue's rate limit before sending and returns `GatewayError::RateLimited` instead of sending.
- Reconnect uses capped exponential backoff with jitter, then resyncs from a snapshot before emitting deltas.
- Every adapter has tests driven by recorded fixtures (real venue messages, scrubbed), stored beside the module.
- Every parser has a fuzz target in engine/fuzz.
- Credentials are passed in by the caller at construction time.

## NEVER
- Never read credentials from files in the repo, env files, or constants. Check: `grep -rnE 'std::fs|include_str|env::var|api_key *=' src` has no credential hit.
- No live venue connections in tests, including testnet. Tests use fixtures only.
- No withdrawal or transfer endpoints (root rule 9). Check: `grep -rniE 'withdraw|transfer' src` prints nothing.
- No AI API calls (root rule 1).
- `poll` never blocks: no `sleep`, no blocking reads.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
_None yet. Entries arrive only through knowledge-sync PRs: `YYYY-MM-DD: <lesson> (<PR link>)`, newest first, max 15._

## See also
- Skill: add-venue-adapter (engine/.claude/skills/), ADR-0003 (venue selection), ../../CLAUDE.md
