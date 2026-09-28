#!/usr/bin/env python3
"""Tier 2 eval: paid, nondeterministic, gated. Runs on merge to main, nightly, and
workflow_dispatch (.github/workflows/eval.yml) — never on every PR (evals/README.md explains why:
cost and nondeterminism, per llm-trading-eval-research.md §5).

  scripts/eval/live_agent.py [--root DIR]

Runs only if BOTH hold, otherwise exits 0 with "skipped: gated off" printed and written to the
report (a skip here is never a pass, same convention as scripts/eval/run.py):
  - `python3 scripts/ci/ai_gate.py loop-agent-eval` allows (autonomy/POLICY.yaml, fail closed);
  - ANTHROPIC_API_KEY is set in the environment.

When allowed, it calls `just agent-sim` in live mode (QC_AGENT_MODE=live) once per frozen
scenario under evals/scenarios/ (evals/scenarios/README.md — three synthetic worldlines sliced
from tests/replay/sample_day.csv) and appends one result line per scenario to
evals/ledger/agent-evals.jsonl. That file is gitignored: this script's own run only ever writes
it as a CI artifact (out/eval upload); a human decides whether a result is worth committing
(root CLAUDE.md rule 6, evals/ledger/README.md).

This is not a stub: the gate and the live call are both real. It is gated off in this repo state
because autonomy/POLICY.yaml has no loop-agent-eval entry yet (added by agentic/agent-service,
disabled and zero-budget even once added) and no ANTHROPIC_API_KEY exists (docs/reports/
base-status.md item 6) — the same "fail closed, not run" state scripts/ci/ai_gate.py reports for
every other paid loop today.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOOP = "loop-agent-eval"
LEDGER = ROOT / "evals/ledger/agent-evals.jsonl"
SCENARIOS_DIR = ROOT / "evals/scenarios"


def gate_allows(root: Path) -> tuple[bool, str]:
    """Fail closed: any error, or ai_gate.py denying, means "do not run" (same contract as
    scripts/ci/ai_gate.py itself: a check that could not run is not a check that passed)."""
    proc = subprocess.run(  # noqa: S603 - fixed local ai_gate.py invocation
        [sys.executable, str(root / "scripts/ci/ai_gate.py"), LOOP, "--root", str(root)],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0, (proc.stdout + proc.stderr).strip()


def scenario_files(root: Path = ROOT) -> list[Path]:
    return sorted((root / "evals/scenarios").glob("worldline-*.csv"))


def run_scenario(root: Path, scenario: Path) -> dict:
    """Calls the live agent over one frozen scenario. `just agent-sim` is added by
    agentic/agent-service; QC_AGENT_MODE=live is this script's contract with it (agentic-spec.md
    protocol v1: QC_AGENT_MODE=live uses the Agent SDK and requires ANTHROPIC_API_KEY)."""
    env = {**os.environ, "QC_AGENT_MODE": "live", "QC_AGENT_SCENARIO": str(scenario)}
    proc = subprocess.run(
        ["just", "agent-sim"],  # noqa: S607 - fixed local `just` command
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    return {
        "ts": dt.datetime.now(dt.UTC).isoformat(),
        "scenario": scenario.name,
        "mode": "live",
        "exit_code": proc.returncode,
        "stdout_tail": "\n".join(proc.stdout.splitlines()[-20:]),
        "stderr_tail": "\n".join(proc.stderr.splitlines()[-20:]),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    root: Path = args.root

    allowed, reason = gate_allows(root)
    if not allowed:
        print(f"skipped: gated off ({reason})")
        return 0
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("skipped: gated off (ANTHROPIC_API_KEY not set)")
        return 0

    scenarios = scenario_files(root)
    if not scenarios:
        print("skipped: gated off (no scenarios under evals/scenarios/)")
        return 0

    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    failures = []
    with LEDGER.open("a", encoding="utf-8") as f:
        for scenario in scenarios:
            result = run_scenario(root, scenario)
            f.write(json.dumps(result) + "\n")
            status = "ok" if result["exit_code"] == 0 else "FAILED"
            print(f"{scenario.name}: {status} (exit {result['exit_code']})")
            if result["exit_code"] != 0:
                failures.append(scenario.name)

    if failures:
        print(f"live agent eval FAILED for: {failures}", file=sys.stderr)
        return 1
    print(f"live agent eval: {len(scenarios)} scenario(s) ok; appended to {LEDGER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
