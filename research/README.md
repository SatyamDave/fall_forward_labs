# research

Python research and the ML stack share one uv project, defined here.

## Layout choice

`research/` is the only uv project: one `pyproject.toml`, one `uv.lock`, one `.venv`. The repository's `ml/` directory is a plain Python package (`import ml`) that runs in this same environment; it has no `pyproject.toml` of its own.

Why: research and ML use the same data stack, and two lockfiles would drift, so a feature computed in research could differ from the one used in training. The project sets `package = false`, so nothing is built or installed; pytest and mypy find `registry` (in this directory) and `ml` (one level up) from source through `pythonpath` and `mypy_path`. If `ml/` ever needs to ship separately, give it its own `pyproject.toml` then.

## Commands

Run from the repository root:

- `just setup` installs the locked environment (`uv sync --locked`).
- `just test` runs pytest over `tests/`, `../ml/tests/` and `../data/`; `just lint` runs ruff and `mypy --strict` on `registry` and `ml` (mypy follows `ml`'s imports into `data`).
- `just walkforward <name>` runs `ml.validation.walkforward` on `backtest/configs/<name>.yaml`.
- To run one test file outside `tests/`, pass the config: `uv run pytest -c pyproject.toml ../ml/tests/test_parity.py`.

Runtime dependencies (numpy, pyarrow, scikit-learn, PyYAML) are pinned exactly in `pyproject.toml` and locked in `uv.lock`.

## Contents

- `registry/`: experiment registry client. Every trial is recorded, failures included. Records live in `registry/log/` (`trials.jsonl`, and `models.jsonl` from `ml.registry`).
- `features/`, `notebooks/`, `sandbox/`: see the README in each.
- `tests/`: tests for research code.
