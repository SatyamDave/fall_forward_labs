# Fall Forward Labs — quant-core

Private algorithmic trading platform: a Rust hot-path engine, Python research and ML, and an
offline agent swarm that proposes changes through pull requests. The goal is a verifiable,
auditable track record, not a demo. This README makes no performance or return claims — see
`docs/VISION.md` for the mission and honest constraints.

## Quickstart (5 minutes)

```sh
just setup   # fetch Rust deps, sync the Python environment
just check   # fmt-check + lint + test + audit
just replay  # replay a recorded market day (placeholder until the engine-core phase lands)
```

`just setup && just check && just replay` should complete without errors on a clean clone. If
`just` isn't installed, see `.devcontainer/` for a preconfigured environment, or install it per
the [just documentation](https://github.com/casey/just).

## Repo map

| Path | What it is |
|------|------------|
| `engine/` | Rust hot path: `core`, `orderbook`, `gateway`, `oms`, `risk` (protected), `strategy-runtime`, `inference`, `telemetry` |
| `strategies/` | One folder per strategy; lifecycle gate status lives in each strategy's README |
| `research/` | Python research; `sandbox/` for automated factor discovery, no venue credentials |
| `ml/` | Self-learning model stack: train → validate → registry → shadow → promote |
| `backtest/` | Fill and latency models, configs, reports |
| `data/` | Schemas, recorders, catalog, data-quality checks |
| `agents/` | Offline agent swarm orchestration; outputs are PRs and reports only |
| `config/` | Risk limits (protected), venues, environments — no secrets |
| `ops/` | Infra, deploy (protected), monitoring |
| `fund/` | Track record and compliance (protected) |
| `docs/` | Vision, architecture, ADRs, runbooks, glossary, onboarding, research graveyard |

## Where to go next

- [`docs/VISION.md`](docs/VISION.md) — mission and honest constraints
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/onboarding/day-1.md`](docs/onboarding/day-1.md) and [`week-1.md`](docs/onboarding/week-1.md) — new-contributor path
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to propose a change, including via Claude Code
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — trading and ML terms used throughout the repo
