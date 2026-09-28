"""Experiment registry: every trial is appended, including failures (root rule 6).

This stub writes JSON Lines to a local file so the trial count used for deflated
Sharpe is honest from the first experiment. ADR-0005 picks the real backend.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Trial:
    experiment: str
    config_hash: str
    passed: bool
    metrics: dict[str, float]
    notes: str = ""


def record(path: Path, trial: Trial) -> None:
    """Append one trial. The file is only ever appended to, never rewritten."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(trial), sort_keys=True) + "\n")


def trial_count(path: Path, experiment: str) -> int:
    """Number of recorded trials for an experiment, failures included."""
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as f:
        return sum(1 for line in f if json.loads(line)["experiment"] == experiment)
