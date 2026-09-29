"""scripts/reports/progress_report.py against SYNTHETIC ledgers built here. None of these entries,
approvals or fills came from a real account or broker."""

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "progress_report", ROOT / "scripts/reports/progress_report.py"
)
assert SPEC and SPEC.loader
progress_report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = progress_report
SPEC.loader.exec_module(progress_report)
pnl_report = progress_report.pnl_report

DAY_NS = 86_400_000_000_000
TODAY = "2026-09-29"
TODAY_NS = 20_725 * DAY_NS  # 2026-09-29T00:00:00Z
POLICY = {
    "fees": {"fee_bps": "0"},
    "account": {"starting_capital_usd": "50", "target_equity_usd": "5000"},
}
LIMITS = {"max_daily_notional": "50", "max_daily_loss": "5"}


def _payload(client_order_id: int) -> str:
    return json.dumps(
        {"client_order_id": client_order_id, "request_id": f"SYNTHETIC-{client_order_id}"}
    )


def _entry(
    i: int,
    action: str,
    mode: str = "live",
    accepted: bool | None = None,
    rationale: str = "SYNTHETIC",
    signal: dict | None = None,
    remaining_loss: str = "5",
) -> dict:
    decision = {"request_id": f"SYNTHETIC-{i}", "action": action, "rationale": rationale}
    if action != "no_trade":
        decision |= {"qty": "1", "limit_price": "20"}
    result = None
    if accepted is not None:
        result = {"accepted": accepted, "client_order_id": i}
        if accepted:
            result["approval"] = {"payload": _payload(i), "signature": "c3ludGhldGlj"}
        else:
            result["risk_reject"] = "max_notional"
    return {
        "request": {
            "request_id": f"SYNTHETIC-{i}",
            "ts_ns": TODAY_NS + i,
            "mid": "20",
            "signal": signal,
            "limits": {"remaining_daily_loss": remaining_loss},
        },
        "decision": decision,
        "result": result,
        "mode": mode,
        "prompt_version": "SYNTHETIC",
        "model": "SYNTHETIC",
    }


def _filled(*client_order_ids: int) -> dict:
    return {
        pnl_report.ref_id_for_approval(_payload(i)): {
            "status": "filled",
            "filled_qty": "1",
            "avg_price": "20",
        }
        for i in client_order_ids
    }


def _build(entries: list[dict], journal: dict) -> dict:
    return progress_report.build_progress(entries, journal, POLICY, LIMITS, None, TODAY)


def test_sim_and_replay_entries_are_excluded_and_counted() -> None:
    entries = [
        _entry(1, "buy", mode="fake", accepted=True),
        _entry(2, "buy", mode="replay", accepted=True),
        _entry(3, "buy", accepted=True),
    ]
    p = _build(entries, _filled(1, 2, 3))
    assert p["excluded_by_mode"] == {"fake": 1, "replay": 1}
    assert p["counts"]["decisions"] == 1
    assert p["counts"]["risk_accepted"] == 1
    assert p["counts"]["broker_confirmed_fills"] == 1
    assert p["risk_budget_today"]["notional_used_usd"] == "20"


def test_accepted_intent_without_a_fill_is_not_a_fill() -> None:
    p = _build([_entry(1, "buy", accepted=True), _entry(2, "sell", accepted=False)], {})
    counts = p["counts"]
    assert counts["proposed_orders"] == 2
    assert counts["risk_accepted"] == 1
    assert counts["risk_rejected"] == 1
    assert counts["broker_confirmed_fills"] == 0
    assert p["realized_pnl_after_fees_usd"] == "0"
    # The engine still counted the accepted order against today's notional cap.
    assert p["risk_budget_today"]["notional_remaining_usd"] == "30"


def test_holds_split_by_reason_with_model_error_first() -> None:
    signal = {"direction": "flat", "probs": [0.2, 0.6, 0.2], "model_sha256": "0" * 64}
    entries = [
        # A failed model call on a request with no signal is still a model error.
        _entry(1, "no_trade", rationale="openrouter: HTTP 429 (rate limited)"),
        _entry(2, "no_trade", rationale="no signal, or signal direction is flat"),
        _entry(3, "no_trade", rationale="spread too wide to pay", signal=signal),
        _entry(4, "no_trade", rationale="openrouter: the model's own wording", signal=signal),
    ]
    holds = _build(entries, {})["counts"]["holds"]
    assert holds == {"null_signal": 1, "model_error": 1, "explicit_hold": 2, "unclassified": 0}


def test_equity_and_progress_unknown_without_a_broker_snapshot() -> None:
    p = _build([_entry(1, "buy", accepted=True, remaining_loss="3.5")], _filled(1))
    assert p["equity_usd"].startswith("UNKNOWN")
    assert p["progress_fraction"] is None and p["multiple_needed"] is None
    assert p["risk_budget_today"]["loss_used_usd"] == "1.5"


def test_main_prints_report_from_files(tmp_path: Path, capsys) -> None:
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text(json.dumps(_entry(1, "buy", accepted=True)) + "\nnot json\n")
    code = progress_report.main(
        [
            "--ledger",
            str(ledger),
            "--broker-journal",
            str(tmp_path / "missing-journal.jsonl"),
            "--reconcile-status",
            str(tmp_path / "missing-status.json"),
            "--date",
            TODAY,
        ]
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "current equity: UNKNOWN (no reconciled position/cash snapshot)" in out
    assert "starting capital: $50" in out
    assert "1 malformed ledger line(s) skipped" in out
