"""scripts/eval/live_agent.py: the gate fails closed in this repo (no ANTHROPIC_API_KEY, no
loop-agent-eval policy entry yet), and the frozen scenario set exists and is non-empty."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("live_agent", ROOT / "scripts/eval/live_agent.py")
assert SPEC and SPEC.loader
live_agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(live_agent)


def test_gate_denies_today() -> None:
    # autonomy/POLICY.yaml.enabled is false and no loop-agent-eval entry exists yet
    # (agentic/agent-service adds it, disabled, zero budget) — this must stay a deny.
    allowed, reason = live_agent.gate_allows(ROOT)
    assert allowed is False
    assert "deny" in reason


def test_main_skips_without_crashing(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert live_agent.main(["--root", str(ROOT)]) == 0


def test_frozen_scenarios_exist_and_are_labelled_synthetic() -> None:
    scenarios = live_agent.scenario_files(ROOT)
    assert len(scenarios) == 3
    for path in scenarios:
        assert "synthetic" in path.read_text().splitlines()[0]
