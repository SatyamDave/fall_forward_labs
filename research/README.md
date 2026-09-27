# research

Python research and the ML stack share one uv project, defined here.

## Layout choice

`research/` is the only uv project: one `pyproject.toml`, one `uv.lock`, one `.venv`. The repository's `ml/` directory is a plain Python package (`import ml`) that runs in this same environment; it has no `pyproject.toml` of its own.

Why: research and ML use the same data stack, and two lockfiles would drift, so a feature computed in research could differ from the one used in training. The project sets `package = false`, so nothing is built or installed; pytest and mypy find `registry` (in this directory) and `ml` (one level up) from source through `pythonpath` and `mypy_path`. If `ml/` ever needs to ship separately, give it its own `pyproject.toml` then.

## Commands

Run from the repository root:

- `just setup` installs the locked environment (`uv sync --locked`).
- `just test` runs pytest; `just lint` runs ruff and `mypy --strict` on `registry` and `ml`.

## Contents

- `registry/`: experiment registry client. Every trial is recorded, failures included.
- `features/`, `notebooks/`, `sandbox/`: see the README in each.
- `tests/`: tests for research code.
