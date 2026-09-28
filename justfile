# quant-core task runner. Run `just` to list recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]

engine := "engine"
research := "research"

default:
    @just --list

# Install toolchains' dependencies for the engine and research environment
setup:
    cd {{engine}} && cargo fetch
    cd {{research}} && uv sync --locked

# Everything CI requires: format check, lint, tests, dependency audit
check: fmt-check lint test audit

# Rewrite files into canonical format
fmt:
    cd {{engine}} && cargo fmt --all
    cd {{research}} && uv run ruff format . ../ml

fmt-check:
    cd {{engine}} && cargo fmt --all --check
    cd {{research}} && uv run ruff format --check . ../ml

lint:
    cd {{engine}} && cargo clippy --workspace --all-targets --locked -- -D warnings
    cd {{research}} && uv run ruff check . ../ml
    cd {{research}} && uv run mypy registry ../ml

test:
    cd {{engine}} && cargo test --workspace --locked
    cd {{research}} && uv run pytest

# Known-vulnerability and license checks; each tool is skipped with a message if it is not installed
audit:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{engine}}
    if command -v cargo-deny >/dev/null && [ -f deny.toml ]; then cargo deny check; else echo "skip: cargo-deny or engine/deny.toml missing (CI runs it; install with 'cargo install cargo-deny')"; fi
    if command -v cargo-audit >/dev/null; then cargo audit; else echo "skip: cargo-audit not installed (CI runs it; install with 'cargo install cargo-audit')"; fi
    cd ../{{research}}
    if command -v pip-audit >/dev/null; then uv export --format requirements-txt --no-hashes --quiet | pip-audit --strict -r /dev/stdin; else echo "skip: pip-audit not installed (CI runs it; install with 'uv tool install pip-audit')"; fi

# Criterion benchmarks for engine hot paths
bench:
    cd {{engine}} && cargo bench --workspace --locked

# Replay a recorded market day and check the order log is reproduced exactly
replay:
    @echo "not implemented yet: engine-core phase (replay of a recorded day)"

# Run a backtest from backtest/configs/<cfg>.yaml
backtest cfg:
    @echo "not implemented yet: backtest phase ({{cfg}})"

# Run a strategy against live data with simulated fills
paper strategy:
    @echo "not implemented yet: paper-trading phase ({{strategy}})"

# Purged, embargoed walk-forward validation for a strategy or model
# Writes backtest/reports/<name>/<date>.md and appends trials + a challenger to the registry.
walkforward name:
    cd {{research}} && PYTHONPATH=..:. uv run --locked python -m ml.validation.walkforward {{name}}

# Show untriaged session learnings
learnings:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    items=(.claude/learnings/inbox/*.md)
    echo "${#items[@]} untriaged learning(s) in .claude/learnings/inbox"
    for f in ${items[@]+"${items[@]}"}; do echo "  $f: $(head -1 "$f" | sed 's/^# //')"; done

# Tests for the Claude Code hooks in .claude/hooks (not part of `test`, which other phases own)
test-hooks:
    cd {{research}} && uv run pytest ../tests/hooks -q
