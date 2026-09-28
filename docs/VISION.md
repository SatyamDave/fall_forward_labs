# Vision

## Mission

Build the most correct, auditable, and fastest-learning trading system a small team can operate. Grow a verifiable track record, then scale into a fund.

## Honest constraints

- No nanosecond latency races early (top HFT = FPGA, hundreds of ns, millions/yr). Edge = signal quality, market-making quality, execution discipline, risk control, iteration speed.
- Initial arena: liquid crypto perps + spot, software-only execution, Rust on cloud/bare metal co-regioned with venue. Architecture venue- and asset-agnostic.
- LLMs/agents never in the live order path. Agents do research, code, review, testing, monitoring summaries, docs. Hot path is deterministic Rust.
- Security goal: no known High/Critical vulnerability reaches main, secrets never in git, an automated gate at every layer. Today the scanners pass in CI on main, but no check is required (branch protection is unavailable on this plan) (docs/reports/base-status.md).
- Learning goal: models retrain and challenge each other automatically; promotion to real capital always passes statistical gates AND human approval. Today only an offline pipeline on synthetic data exists; nothing retrains on its own.

## What this document is not

It makes no performance claims and sets no return targets. Results exist only as reconciled records in `fund/track-record/`. The rules that enforce these constraints are in the root `CLAUDE.md`; the structure that implements them is in `docs/ARCHITECTURE.md`.
