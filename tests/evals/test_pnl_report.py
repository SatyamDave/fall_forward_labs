"""scripts/reports/pnl_report.py: hand-computed expected values for the average-cost fill
accounting, the full compute() pipeline against a small fixture ledger, the stop-rule evaluator,
and the append-only guarantee on daily records (issue #70)."""

import importlib.util
import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("pnl_report", ROOT / "scripts/reports/pnl_report.py")
assert SPEC and SPEC.loader
pnl_report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pnl_report
SPEC.loader.exec_module(pnl_report)

D = Decimal
Position = pnl_report.Position
apply_fill = pnl_report.apply_fill

ONE_DAY_NS = 86_400_000_000_000


# --- apply_fill: hand-computed, no fees -----------------------------------------------------


def test_buy_then_partial_sells_same_direction_no_flip() -> None:
    pos = Position()
    pos = apply_fill(pos, "buy", D(10), D(100), D(0))
    assert pos.qty == D(10) and pos.avg_cost == D(100) and pos.realized_pnl == D(0)

    pos = apply_fill(pos, "sell", D(4), D(110), D(0))
    # closing 4 of a long 10 at 110 vs avg cost 100: realized = (110-100)*4 = 40
    assert pos.qty == D(6)
    assert pos.avg_cost == D(100)  # unchanged: still long, just smaller
    assert pos.realized_pnl == D(40)

    pos = apply_fill(pos, "sell", D(6), D(90), D(0))
    # closing the remaining 6 at 90 vs avg cost 100: realized_delta = (90-100)*6 = -60
    assert pos.qty == D(0)
    assert pos.realized_pnl == D(40) + D(-60) == D(-20)


def test_buy_adds_to_position_with_weighted_average_cost() -> None:
    pos = Position()
    pos = apply_fill(pos, "buy", D(10), D(100), D(0))
    pos = apply_fill(pos, "buy", D(5), D(130), D(0))
    # weighted avg cost = (100*10 + 130*5) / 15 = 1650/15 = 110
    assert pos.qty == D(15)
    assert pos.avg_cost == D(110)
    assert pos.realized_pnl == D(0)


def test_sell_more_than_held_flips_to_short_and_realizes_the_closed_portion() -> None:
    pos = Position()
    pos = apply_fill(pos, "buy", D(5), D(100), D(0))
    pos = apply_fill(pos, "sell", D(8), D(90), D(0))
    # closes 5 long at 90 vs avg 100: realized = (90-100)*5 = -50; remaining 3 opens short at 90
    assert pos.qty == D(-3)
    assert pos.avg_cost == D(90)
    assert pos.realized_pnl == D(-50)


def test_buy_covers_a_short_and_realizes_the_closed_portion() -> None:
    pos = Position(qty=D(-3), avg_cost=D(90), realized_pnl=D(-50), fees_paid=D(0))
    pos = apply_fill(pos, "buy", D(3), D(80), D(0))
    # covering a short of 3 (entered at 90) by buying at 80: realized_delta = (90-80)*3 = 30
    assert pos.qty == D(0)
    assert pos.realized_pnl == D(-50) + D(30) == D(-20)


def test_fee_is_realized_immediately_as_a_cash_cost() -> None:
    pos = Position()
    pos = apply_fill(pos, "buy", D(10), D(100), D(10))  # fee_bps=10 -> 10*100*10/10000 = 1.0
    assert pos.fees_paid == D("1.0")
    assert pos.realized_pnl == D("-1.0")  # opening has no trading realized P&L, only the fee
    assert pos.avg_cost == D(100)  # fee never distorts cost basis


def test_unrealized_pnl_long_and_short() -> None:
    long = Position(qty=D(2), avg_cost=D(100))
    assert long.unrealized_pnl(D(110)) == D(20)
    short = Position(qty=D(-2), avg_cost=D(100))
    assert short.unrealized_pnl(D(110)) == D(-20)
    flat = Position()
    assert flat.unrealized_pnl(D(500)) == D(0)


# --- compute(): a small, fully hand-computed fixture ledger ----------------------------------


def _entry(
    request_id: str,
    ts_ns: int,
    action: str,
    mid: str,
    result: dict | None,
    cost_usd: float,
    **decision_extra,
) -> dict:
    decision = {"request_id": request_id, "action": action, "rationale": "test"}
    decision.update(decision_extra)
    return {
        "request": {
            "request_id": request_id,
            "ts_ns": ts_ns,
            "instrument": "1",
            "best_bid": mid,
            "best_ask": mid,
            "mid": mid,
            "spread_ticks": 0,
            "features": {},
            "signal": None,
            "position": "0",
            "limits": {
                "max_position": "1",
                "max_notional": "1000",
                "max_order_rate_per_sec": 5,
                "remaining_daily_loss": "100",
            },
            "allowed_actions": ["buy", "sell", "no_trade"],
        },
        "decision": decision,
        "result": result,
        "mode": "fake",
        "prompt_version": "v1",
        "model": "test",
        # Wave 2: cost_usd is a decimal string on the wire (agent/src/types.ts); this helper
        # still takes a plain float for readability at each call site.
        "cost_usd": str(cost_usd),
    }


# day0 (ts=0): no_trade, mid=100 -> both agent and buy-and-hold flat/at-entry, equal (not "behind").
# day1 (ts=1 day): agent buys 1 @ 110, mid=110 -> agent flat P&L 0 (bought at the mark), but
#   buy-and-hold (entered day0 at mid=100, size 1) is already up (110-100)=10 -> agent behind.
# day2 (ts=2 days): no_trade, mid=90 -> agent unrealized (90-110)*1=-20; buy-and-hold
#   unrealized (90-100)*1=-10 -> agent behind again.
FIXTURE_LEDGER = [
    _entry("dr-0", 0, "no_trade", "100", None, 0.0),
    _entry(
        "dr-1",
        ONE_DAY_NS,
        "buy",
        "110",
        {"accepted": True, "client_order_id": 1},
        0.05,
        qty="1",
        limit_price="110",
    ),
    _entry("dr-2", 2 * ONE_DAY_NS, "no_trade", "90", None, 0.03),
]


def test_compute_agent_and_buy_and_hold_totals_hand_computed() -> None:
    result, _curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    assert result.entry_count == 3
    # agent: bought 1@110, never sold; mark_final=90 -> unrealized (90-110)*1=-20, realized/fees=0
    assert result.agent == {
        "realized_pnl_usd": "0",
        "fees_paid_usd": "0",
        "unrealized_pnl_usd": "-20",
        "total_pnl_after_fees_usd": "-20",
    }
    # buy-and-hold: entered day0 at mid=100, size 1 (agent's peak); mark_final=90 -> unrealized -10
    assert result.buy_and_hold == {
        "realized_pnl_usd": "0",
        "fees_paid_usd": "0",
        "unrealized_pnl_usd": "-10",
        "total_pnl_after_fees_usd": "-10",
    }
    assert result.no_trade == {"total_pnl_usd": "0"}


def test_compute_ai_cost_is_summed_across_entries() -> None:
    result, _curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    assert result.ai_cost_usd == str(D("0.0") + D("0.05") + D("0.03"))


def test_compute_max_drawdown_hand_computed() -> None:
    # agent equity curve: [0 (flat at entry), 0 (just bought at the mark), -20] -> peak stays 0,
    # worst drop is 0 - (-20) = 20.
    result, _curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    assert result.max_drawdown_usd == "20"


def test_buy_and_hold_not_computed_when_agent_never_trades() -> None:
    entries = [_entry("dr-0", 0, "no_trade", "100", None, 0.0)]
    result, _curve = pnl_report.compute(entries, fee_bps=D(0))
    assert result.buy_and_hold is None


# --- evaluate_stop_rule -----------------------------------------------------------------------


def _policy(max_drawdown: str, max_days: int) -> dict:
    return {
        "stop_rule": {
            "max_drawdown_usd": max_drawdown,
            "max_consecutive_days_behind_buy_and_hold": max_days,
        }
    }


def test_stop_rule_triggers_on_consecutive_days_behind_buy_and_hold() -> None:
    result, curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    # day1 and day2 are both behind (hand-computed above); day0 is exactly equal, not behind.
    stop = pnl_report.evaluate_stop_rule(result, curve, _policy("1000", 2))
    assert stop["triggered"] is True
    assert any("2 consecutive day" in r for r in stop["reasons"])


def test_stop_rule_does_not_trigger_below_threshold() -> None:
    result, curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    stop = pnl_report.evaluate_stop_rule(result, curve, _policy("1000", 3))
    assert stop["triggered"] is False
    assert stop["reasons"] == []


def test_stop_rule_triggers_on_drawdown() -> None:
    result, curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    stop = pnl_report.evaluate_stop_rule(result, curve, _policy("10", 999))
    assert stop["triggered"] is True
    assert any("drawdown" in r for r in stop["reasons"])


def test_stop_rule_thresholds_are_labelled_placeholder() -> None:
    result, curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    stop = pnl_report.evaluate_stop_rule(result, curve, _policy("1000", 999))
    assert "#23" in stop["thresholds_source"]


# --- the committed pnl_policy.toml parses and is internally consistent ------------------------


def test_committed_policy_file_loads() -> None:
    policy = pnl_report.load_policy(pnl_report.DEFAULT_POLICY)
    assert Decimal(str(policy["fees"]["fee_bps"])) >= 0
    assert Decimal(str(policy["stop_rule"]["max_drawdown_usd"])) > 0
    assert int(policy["stop_rule"]["max_consecutive_days_behind_buy_and_hold"]) > 0


# --- append-only daily records -----------------------------------------------------------------


def test_write_daily_record_is_idempotent_for_identical_content(tmp_path: Path) -> None:
    result, _curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    result.stop_rule = pnl_report.evaluate_stop_rule(result, _curve, _policy("1000", 999))
    path1 = pnl_report.write_daily_record(result, "2026-01-01", tmp_path)
    path2 = pnl_report.write_daily_record(result, "2026-01-01", tmp_path)
    assert path1 == path2
    assert json.loads(path1.read_text())["date"] == "2026-01-01"


# --- --source broker: P&L from the gateway journal's real fills (issue #45) ------------------


def _journal_line(client_order_id: int, phase: str, **result_fields: object) -> str:
    entry: dict = {"client_order_id": client_order_id, "phase": phase}
    if phase == "resolved":
        entry["result"] = {"raw": {}, **result_fields}
    return json.dumps(entry)


def test_broker_resolver_uses_the_journals_fill_not_the_decisions_estimate() -> None:
    # Decision proposed 1@110; the broker actually filled 1@111 (report_execution's own price) --
    # the whole point of #45 is that this, not the decision's guess, is what P&L is built from.
    entries = [
        _entry(
            "dr-1",
            0,
            "buy",
            "110",
            {"accepted": True, "client_order_id": 1},
            0.0,
            qty="1",
            limit_price="110",
        ),
    ]
    journal = {1: {"status": "filled", "filled_qty": "1", "avg_price": "111"}}
    resolver = pnl_report.make_broker_fill_resolver(journal)
    result, _curve = pnl_report.compute(entries, fee_bps=D(0), resolve_fill=resolver)
    # bought 1@111 (not 110): mark_final=110 -> unrealized (110-111)*1 = -1
    assert result.agent["unrealized_pnl_usd"] == "-1"
    assert result.fills == {"accepted_orders": 1, "matched_fills": 1}


def test_broker_resolver_drops_an_order_the_journal_never_resolved() -> None:
    # Accepted by the bridge, but the broker journal has no resolved entry yet (still in flight,
    # or the process crashed before learning the outcome) -- must NOT be assumed filled.
    entries = [
        _entry(
            "dr-1",
            0,
            "buy",
            "110",
            {"accepted": True, "client_order_id": 1},
            0.0,
            qty="1",
            limit_price="110",
        ),
    ]
    resolver = pnl_report.make_broker_fill_resolver({})
    result, _curve = pnl_report.compute(entries, fee_bps=D(0), resolve_fill=resolver)
    assert result.agent["unrealized_pnl_usd"] == "0"  # no fill applied at all
    assert result.fills == {"accepted_orders": 1, "matched_fills": 0}


def test_broker_resolver_drops_a_rejected_or_canceled_order() -> None:
    entries = [
        _entry(
            "dr-1",
            0,
            "buy",
            "110",
            {"accepted": True, "client_order_id": 1},
            0.0,
            qty="1",
            limit_price="110",
        ),
    ]
    journal = {1: {"status": "rejected", "reason": "insufficient_funds"}}
    resolver = pnl_report.make_broker_fill_resolver(journal)
    result, _curve = pnl_report.compute(entries, fee_bps=D(0), resolve_fill=resolver)
    assert result.agent["unrealized_pnl_usd"] == "0"
    assert result.fills == {"accepted_orders": 1, "matched_fills": 0}


def test_broker_resolver_uses_partial_fill_quantity() -> None:
    entries = [
        _entry(
            "dr-1",
            0,
            "buy",
            "110",
            {"accepted": True, "client_order_id": 1},
            0.0,
            qty="10",
            limit_price="110",
        ),
    ]
    journal = {1: {"status": "partially_filled", "filled_qty": "4", "avg_price": "109"}}
    resolver = pnl_report.make_broker_fill_resolver(journal)
    result, _curve = pnl_report.compute(entries, fee_bps=D(0), resolve_fill=resolver)
    # only 4 filled (not the requested 10) @109: mark_final=110 -> unrealized (110-109)*4 = 4
    assert result.agent["unrealized_pnl_usd"] == "4"


def test_load_broker_journal_last_entry_per_client_order_id_wins(tmp_path: Path) -> None:
    path = tmp_path / "broker-journal.jsonl"
    path.write_text(
        "\n".join(
            [
                _journal_line(1, "attempt"),
                _journal_line(1, "resolved", status="filled", filled_qty="1", avg_price="100"),
                _journal_line(2, "attempt"),  # never resolved -- must not appear in the map at all
            ]
        )
        + "\n"
    )
    journal = pnl_report.load_broker_journal(path)
    assert journal == {1: {"status": "filled", "filled_qty": "1", "avg_price": "100", "raw": {}}}


def test_load_broker_journal_missing_file_is_empty(tmp_path: Path) -> None:
    assert pnl_report.load_broker_journal(tmp_path / "does-not-exist.jsonl") == {}


def test_load_broker_journal_rejects_a_corrupt_line(tmp_path: Path) -> None:
    path = tmp_path / "broker-journal.jsonl"
    path.write_text('{"client_order_id": 1, "phase": "sideways"}\n')
    try:
        pnl_report.load_broker_journal(path)
        raised = False
    except ValueError:
        raised = True
    assert raised, "an unrecognized journal entry shape must fail closed, not be skipped"


def test_build_report_source_broker_labels_the_result_reconciled(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text(
        json.dumps(
            _entry(
                "dr-1",
                0,
                "buy",
                "110",
                {"accepted": True, "client_order_id": 1},
                0.0,
                qty="1",
                limit_price="110",
            )
        )
        + "\n"
    )
    journal = tmp_path / "broker-journal.jsonl"
    journal.write_text(
        _journal_line(1, "resolved", status="filled", filled_qty="1", avg_price="111") + "\n"
    )

    result, _curve = pnl_report.build_report(
        ledger,
        pnl_report.DEFAULT_POLICY,
        source=pnl_report.SOURCE_RECONCILED,
        broker_journal=journal,
    )
    assert result.source == "reconciled"
    assert result.agent["unrealized_pnl_usd"] == "-1"  # filled at 111, not the decision's 110


def test_build_report_default_source_is_unchanged() -> None:
    result, _curve = pnl_report.build_report(pnl_report.DEFAULT_LEDGER, pnl_report.DEFAULT_POLICY)
    assert result.source == "decision_ledger_estimate"


def test_cli_source_broker_writes_reconciled_and_exits_on_stop_rule(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text(
        json.dumps(
            _entry(
                "dr-1",
                0,
                "buy",
                "110",
                {"accepted": True, "client_order_id": 1},
                0.0,
                qty="1",
                limit_price="110",
            )
        )
        + "\n"
    )
    journal = tmp_path / "broker-journal.jsonl"
    journal.write_text(
        _journal_line(1, "resolved", status="filled", filled_qty="1", avg_price="111") + "\n"
    )
    out_dir = tmp_path / "daily"

    code = pnl_report.main(
        [
            "--ledger",
            str(ledger),
            "--broker-journal",
            str(journal),
            "--source",
            "broker",
            "--date",
            "2026-02-02",
            "--out",
            str(out_dir),
        ]
    )
    written = json.loads((out_dir / "2026-02-02.json").read_text())
    assert written["source"] == "reconciled"
    assert written["fills"] == {"accepted_orders": 1, "matched_fills": 1}
    assert code == 0  # stop rule not tripped by this tiny fixture


def test_write_daily_record_refuses_to_overwrite_different_content(tmp_path: Path) -> None:
    result, curve = pnl_report.compute(FIXTURE_LEDGER, fee_bps=D(0))
    result.stop_rule = pnl_report.evaluate_stop_rule(result, curve, _policy("1000", 999))
    pnl_report.write_daily_record(result, "2026-01-01", tmp_path)

    other_entries = [*FIXTURE_LEDGER, _entry("dr-3", 3 * ONE_DAY_NS, "no_trade", "90", None, 0.0)]
    other_result, other_curve = pnl_report.compute(other_entries, fee_bps=D(0))
    other_result.stop_rule = pnl_report.evaluate_stop_rule(
        other_result, other_curve, _policy("1000", 999)
    )
    try:
        pnl_report.write_daily_record(other_result, "2026-01-01", tmp_path)
        raised = False
    except RuntimeError:
        raised = True
    assert raised, "overwriting an existing day's record with different content must raise"
