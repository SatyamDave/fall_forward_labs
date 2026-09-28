# Decision handoff schemas v1

Contract between the Rust `qc-bridge` and the TypeScript agent service (ADR-0040). JSON Lines over stdio; decimal strings for money and quantity; integer nanosecond timestamps. Both sides validate against these files in tests. Change them only with a version bump (`v2/`).
