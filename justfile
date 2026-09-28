# quant-core task runner. Run `just` to list recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]

engine := "engine"
research := "research"
# Python outside research/ and ml/ that ruff also checks, relative to research/. Not listed:
# autonomy/ and tests/autonomy/ (protected paths that fail ruff today; fixing them needs a T3 PR),
# and tests/replay/generate_sample_day.py (S311, PTH123; the fixture it wrote must stay identical).
py_extra := "../data ../scripts ../tests/knowledge ../tests/hooks ../tests/ci ../.claude/hooks"

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
    cd {{research}} && uv run ruff format . ../ml {{py_extra}}

fmt-check:
    cd {{engine}} && cargo fmt --all --check
    cd {{research}} && uv run ruff format --check . ../ml {{py_extra}}

lint:
    cd {{engine}} && cargo clippy --workspace --all-targets --locked -- -D warnings
    cd {{research}} && uv run ruff check . ../ml {{py_extra}}
    cd {{research}} && uv run mypy registry ../ml

# One pytest run per suite so the log shows each suite's own pass count.
test:
    cd {{engine}} && cargo test --workspace --locked
    cd {{research}} && uv run pytest -q
    cd {{research}} && uv run pytest -q ../tests/hooks
    cd {{research}} && uv run pytest -q ../tests/knowledge
    cd {{research}} && uv run pytest -q ../tests/autonomy
    cd {{research}} && uv run pytest -q ../tests/ci
    cd {{research}} && uv run pytest -q studies/0001-favorite-longshot/tests

# Known-vulnerability and license checks; each tool is skipped with a message if it is not installed
audit:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{engine}}
    if command -v cargo-deny >/dev/null && [ -f deny.toml ]; then cargo deny check; else echo "skip: cargo-deny or engine/deny.toml missing (CI runs it; install with 'cargo install cargo-deny')"; fi
    if command -v cargo-audit >/dev/null; then cargo audit --deny warnings; else echo "skip: cargo-audit not installed (CI runs it; install with 'cargo install cargo-audit')"; fi
    cd ../{{research}}
    if command -v pip-audit >/dev/null; then uv export --format requirements-txt --no-hashes --quiet | pip-audit --strict -r /dev/stdin; else echo "skip: pip-audit not installed (CI runs it; install with 'uv tool install pip-audit')"; fi

# Install the git pre-commit hook and run every hook once over the whole tree
precommit:
    uvx pre-commit install
    uvx pre-commit run --all-files

# Criterion benchmarks for engine hot paths
bench:
    cd {{engine}} && cargo bench --workspace --locked

# Replay the synthetic fixture day (tests/replay/sample_day.csv) twice and check both order logs match
replay:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{engine}}
    sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
    out=$(mktemp -d)
    cargo build --release --locked -q -p qc-replay
    for run in 1 2; do ./target/release/qc-replay ../tests/replay/sample_day.csv "$out/orders-$run.log"; done
    first=$(sha "$out/orders-1.log"); second=$(sha "$out/orders-2.log")
    echo "run 1 order-log sha256: $first"
    echo "run 2 order-log sha256: $second"
    if [ "$first" != "$second" ]; then echo "FAIL: replay is not deterministic"; exit 1; fi
    echo "replay deterministic"

# Run a backtest from backtest/configs/<cfg>.yaml (not implemented: exits 2 so nothing mistakes it for a pass)
backtest cfg:
    @echo "not implemented: no execution backtest exists yet ({{cfg}}); 'just walkforward <name>' is the label-level evaluation" >&2
    @exit 2

# Run a strategy against live data with simulated fills
paper strategy:
    @echo "refused: paper trading needs live market data, and bootstrap allows no venue connections ({{strategy}})" >&2
    @exit 1

# Purged, embargoed walk-forward validation for a strategy or model.
# By default writes only to the gitignored out/walkforward/<name>/ (report, trials, challenger).
# `just walkforward <name> --record` writes backtest/reports/<name>/<date>.md and the canonical registry.
walkforward name *record:
    cd {{research}} && PYTHONPATH=..:. uv run --locked python -m ml.validation.walkforward {{name}} {{record}}

# Show untriaged session learnings
learnings:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    items=(.claude/learnings/inbox/*.md)
    echo "${#items[@]} untriaged learning(s) in .claude/learnings/inbox"
    for f in ${items[@]+"${items[@]}"}; do echo "  $f: $(head -1 "$f" | sed 's/^# //')"; done

# Tests for the Claude Code hooks in .claude/hooks alone (also part of `test`)
test-hooks:
    cd {{research}} && uv run pytest ../tests/hooks -q

# Study 0001 (favorite-longshot bias): offline analysis from the saved snapshot, then its checks
study-0001:
    cd {{research}} && uv run python studies/0001-favorite-longshot/study.py
    cd {{research}} && uv run pytest studies/0001-favorite-longshot/tests -q
