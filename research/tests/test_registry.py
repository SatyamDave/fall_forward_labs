from pathlib import Path

from registry import Trial, record, trial_count


def test_failed_trials_are_counted(tmp_path: Path) -> None:
    log = tmp_path / "registry" / "trials.jsonl"
    assert trial_count(log, "mm-btc") == 0
    record(log, Trial("mm-btc", "abc", passed=False, metrics={"sharpe": -0.2}))
    record(log, Trial("mm-btc", "def", passed=True, metrics={"sharpe": 1.1}))
    record(log, Trial("other", "abc", passed=False, metrics={}))
    assert trial_count(log, "mm-btc") == 2
    assert len(log.read_text().splitlines()) == 3
