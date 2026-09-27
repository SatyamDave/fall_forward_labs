# research/ — Python research and the shared uv environment for research/ and ml/

## Owns / does not own
- Owns: the single uv project (pyproject.toml, uv.lock, Python 3.12), `registry/` (append-only JSONL experiment registry: `Trial`, `record`, `trial_count`), `features/` (exploratory), `notebooks/`, `sandbox/`, `tests/`.
- Does not own: production features (ml/features), models (ml/), strategy code (strategies/), backtest fill and latency models (backtest/).

## Commands
- `uv sync --locked`
- `uv run pytest`
- `uv run ruff check . ../ml` and `uv run ruff format --check . ../ml`
- `uv run mypy registry ../ml` (strict)
- `just walkforward <name>`; `just check` before pushing

## MUST
- Point-in-time data only: every join is as-of the decision timestamp; a lookahead test covers each new feature.
- Validation uses purged, embargoed CV plus walk-forward; no plain k-fold on time series.
- Reports give deflated Sharpe with the true trial count from `trial_count(...)`, and PBO.
- Every trial is written with `registry.record`, failures included (root rule 6). Check: the PR links the registry entries it created.
- Check docs/research/graveyard.md before starting an idea; a failed idea gets a graveyard row.
- Fixed seeds for anything random, logged with the trial.
- Dependencies change only through `uv add` so uv.lock stays in sync (`uv sync --locked` fails otherwise).

## NEVER
- Production code and tests never import notebooks. Check: `grep -rnE '^ *(import|from) +notebooks' --include='*.py' . ../ml ../strategies` prints nothing.
- Never edit or delete registry lines; the registry is append-only.
- No venue credentials or live venue connections from research (root rules 1, 2).
- Never report a Sharpe without its trial count.

## Gotchas
_None yet. Each entry links to the PR or postmortem where it bit us._

## Learned
<!-- None yet. Entries arrive only through knowledge-sync PRs, newest first, max 15, format: - YYYY-MM-DD: <lesson> ([#N](https://github.com/SatyamDave/fall_forward_labs/pull/N)) -->

## See also
- Skills: research/.claude/skills/ (run-walkforward, overfitting-report, graveyard-entry)
- Rule: .claude/rules/python-research.md; ADR-0005 (data storage); README.md (layout choice)
