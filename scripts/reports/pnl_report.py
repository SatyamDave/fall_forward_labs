#!/usr/bin/env python3
"""Issue #70: track honest profit, and know when to stop.

  scripts/reports/pnl_report.py [--ledger PATH] [--policy PATH] [--date YYYY-MM-DD] [--out DIR]

Computes realized + unrealized P&L after fees from the decision ledger, next to two baselines
(no-trade, buy-and-hold), cumulative drawdown, and AI cost — then evaluates a stop rule read from
`scripts/reports/pnl_policy.toml` (placeholder thresholds, pending founders' decision #23; see
that file's own docstring). Writes one append-only file per day to
`fund/track-record/daily/<date>.json` (fund/track-record/README.md documents the format);
`--date` picks which trading day this run is for (default: the ledger's last entry's date, UTC).

Money math is `decimal.Decimal` throughout — never a float (root CLAUDE.md: no floats for money).

## Known limitation (recorded, not hidden)

This reads the *decision* ledger (`out/agent/ledger.jsonl`), not a reconciled venue ledger: issue
#45 (daily reconciliation against Robinhood's own reported state) does not exist yet. Every fill
here is an *assumption* — an accepted buy/sell decision is treated as fully filled at its own
`limit_price` and `qty` — not a real venue fill price. Every report's `source` field says
`"decision_ledger_estimate"` for exactly this reason, and this script does not claim to be
`"reconciled"`. Swap in #45's real fills the day that ledger exists; nothing else here changes
shape (`apply_fill` reads `(side, qty, price)` regardless of where those three values come from).

Standard library only, matching every other script in scripts/eval and scripts/reports.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import tomllib
from dataclasses import asdict, dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = ROOT / "out/agent/ledger.jsonl"
DEFAULT_POLICY = Path(__file__).resolve().parent / "pnl_policy.toml"
DEFAULT_OUT = ROOT / "fund/track-record/daily"
SOURCE = "decision_ledger_estimate"


@dataclass
class Position:
    """Average-cost accounting for one instrument. `qty` is signed: positive is long, negative is
    short. All fields are `Decimal`; this is intentionally the entire piece of state a fill needs
    to update (see `apply_fill`)."""

    qty: Decimal = Decimal(0)
    avg_cost: Decimal = Decimal(0)
    realized_pnl: Decimal = Decimal(0)
    fees_paid: Decimal = Decimal(0)

    def unrealized_pnl(self, mark: Decimal) -> Decimal:
        if self.qty == 0:
            return Decimal(0)
        if self.qty > 0:
            return (mark - self.avg_cost) * self.qty
        return (self.avg_cost - mark) * -self.qty

    def total_pnl_after_fees(self, mark: Decimal) -> Decimal:
        return self.realized_pnl - self.fees_paid + self.unrealized_pnl(mark)


def apply_fill(
    pos: Position, side: str, qty: Decimal, price: Decimal, fee_bps: Decimal
) -> Position:
    """One fill's effect on a `Position`, average-cost method. `side` is `"buy"` or `"sell"`.
    A fill that flips the position (sells more than the current long, or buys more than the
    current short) realizes P&L on the closed portion at `price`, then opens the remainder as a
    new position at `price`. The fee (bps of notional) is always realized immediately, regardless
    of direction — it is a cash cost, not a mark-to-market one."""
    signed = qty if side == "buy" else -qty
    fee = qty * price * fee_bps / Decimal(10000)
    new_qty = pos.qty + signed
    same_direction = pos.qty == 0 or (pos.qty > 0) == (signed > 0)
    if same_direction:
        total_cost = pos.avg_cost * abs(pos.qty) + price * qty
        avg_cost = total_cost / abs(new_qty) if new_qty != 0 else Decimal(0)
        realized_delta = Decimal(0)
    else:
        closing_qty = min(qty, abs(pos.qty))
        if pos.qty > 0:
            realized_delta = (price - pos.avg_cost) * closing_qty
        else:
            realized_delta = (pos.avg_cost - price) * closing_qty
        avg_cost = price if qty > abs(pos.qty) else pos.avg_cost
    return Position(
        qty=new_qty,
        avg_cost=avg_cost,
        realized_pnl=pos.realized_pnl + realized_delta - fee,
        fees_paid=pos.fees_paid + fee,
    )


def _load_entries(ledger: Path) -> list[dict[str, Any]]:
    if not ledger.exists():
        return []
    entries = []
    for line in ledger.read_text().splitlines():
        if line.strip():
            entries.append(json.loads(line))
    return entries


def _day(ts_ns: int) -> str:
    return dt.datetime.fromtimestamp(ts_ns / 1e9, tz=dt.UTC).date().isoformat()


@dataclass
class EquityPoint:
    day: str
    ts_ns: int
    agent_equity: Decimal
    bh_equity: Decimal | None


@dataclass
class PnLResult:
    source: str
    entry_count: int
    agent: dict[str, str]
    no_trade: dict[str, str]
    buy_and_hold: dict[str, str] | None
    max_drawdown_usd: str
    ai_cost_usd: str
    stop_rule: dict[str, Any]


def compute(entries: list[dict[str, Any]], fee_bps: Decimal) -> tuple[PnLResult, list[EquityPoint]]:
    """Two passes over `entries`, both cheap and both needed for a *fixed* buy-and-hold size:
    pass 1 replays every fill to find the agent's peak absolute position (the buy-and-hold
    baseline is sized to this — see module docstring: no arbitrary reference size is invented);
    pass 2 marks the agent's position and a buy-and-hold position (entered once, at the first
    entry's mid, for that same size) to every entry's own mid, building both equity curves in
    lockstep for the drawdown and stop-rule checks below."""
    pos = Position()
    position_curve: list[Position] = []
    peak_abs_qty = Decimal(0)
    ai_cost = Decimal(0)
    for entry in entries:
        decision = entry.get("decision", {})
        result = entry.get("result")
        cost = entry.get("cost_usd")
        if isinstance(cost, (int, float)):
            ai_cost += Decimal(str(cost))
        action = decision.get("action")
        if (
            action in ("buy", "sell")
            and isinstance(result, dict)
            and result.get("accepted") is True
        ):
            qty = Decimal(str(decision["qty"]))
            price = Decimal(str(decision["limit_price"]))
            pos = apply_fill(pos, action, qty, price, fee_bps)
        position_curve.append(pos)
        peak_abs_qty = max(peak_abs_qty, abs(pos.qty))

    first_mid = Decimal(str(entries[0]["request"]["mid"])) if entries else Decimal(0)
    bh_pos: Position | None = None
    if peak_abs_qty > 0 and first_mid > 0:
        bh_pos = apply_fill(Position(), "buy", peak_abs_qty, first_mid, fee_bps)

    curve: list[EquityPoint] = []
    for entry, agent_pos in zip(entries, position_curve, strict=True):
        request = entry.get("request", {})
        mid = Decimal(str(request.get("mid", "0")))
        ts_ns = int(request.get("ts_ns", 0))
        bh_equity = bh_pos.total_pnl_after_fees(mid) if bh_pos is not None else None
        curve.append(
            EquityPoint(_day(ts_ns), ts_ns, agent_pos.total_pnl_after_fees(mid), bh_equity)
        )
    pos = position_curve[-1] if position_curve else pos

    max_drawdown = Decimal(0)
    peak = Decimal("-Infinity")
    for point in curve:
        peak = max(peak, point.agent_equity)
        max_drawdown = max(max_drawdown, peak - point.agent_equity)

    mark_final = Decimal(str(entries[-1]["request"]["mid"])) if entries else Decimal(0)
    agent_summary = {
        "realized_pnl_usd": str(pos.realized_pnl),
        "fees_paid_usd": str(pos.fees_paid),
        "unrealized_pnl_usd": str(pos.unrealized_pnl(mark_final)),
        "total_pnl_after_fees_usd": str(pos.total_pnl_after_fees(mark_final)),
    }
    bh_summary = None
    if bh_pos is not None:
        bh_summary = {
            "realized_pnl_usd": str(bh_pos.realized_pnl),
            "fees_paid_usd": str(bh_pos.fees_paid),
            "unrealized_pnl_usd": str(bh_pos.unrealized_pnl(mark_final)),
            "total_pnl_after_fees_usd": str(bh_pos.total_pnl_after_fees(mark_final)),
        }

    result = PnLResult(
        source=SOURCE,
        entry_count=len(entries),
        agent=agent_summary,
        no_trade={"total_pnl_usd": "0"},
        buy_and_hold=bh_summary,
        max_drawdown_usd=str(max_drawdown),
        ai_cost_usd=str(ai_cost),
        stop_rule={},  # filled in by evaluate_stop_rule
    )
    return result, curve


def evaluate_stop_rule(
    result: PnLResult, curve: list[EquityPoint], policy: dict[str, Any]
) -> dict[str, Any]:
    thresholds = policy["stop_rule"]
    max_dd = Decimal(str(thresholds["max_drawdown_usd"]))
    max_days = int(thresholds["max_consecutive_days_behind_buy_and_hold"])
    reasons = []

    drawdown = Decimal(result.max_drawdown_usd)
    if drawdown > max_dd:
        reasons.append(f"drawdown ${drawdown} exceeds ${max_dd}")

    if any(p.bh_equity is not None for p in curve):
        by_day: dict[str, EquityPoint] = {}
        for p in curve:
            by_day[p.day] = p  # last entry per day wins: closing snapshot
        days_sorted = sorted(by_day)
        streak = 0
        for day in reversed(days_sorted):
            point = by_day[day]
            if point.bh_equity is not None and point.agent_equity < point.bh_equity:
                streak += 1
            else:
                break
        if streak >= max_days:
            reasons.append(
                f"{streak} consecutive day(s) behind buy-and-hold (threshold {max_days})"
            )

    return {
        "triggered": bool(reasons),
        "reasons": reasons,
        "thresholds": {
            "max_drawdown_usd": str(max_dd),
            "max_consecutive_days_behind_buy_and_hold": max_days,
        },
        "thresholds_source": (
            "placeholder pending founders' decision #23, see scripts/reports/pnl_policy.toml"
        ),
    }


def load_policy(path: Path) -> dict[str, Any]:
    with path.open("rb") as f:
        return tomllib.load(f)


def build_report(ledger: Path, policy_path: Path) -> tuple[PnLResult, list[EquityPoint]]:
    entries = _load_entries(ledger)
    policy = load_policy(policy_path)
    fee_bps = Decimal(str(policy["fees"]["fee_bps"]))
    result, curve = compute(entries, fee_bps)
    result.stop_rule = evaluate_stop_rule(result, curve, policy)
    return result, curve


def daily_file_path(out_dir: Path, date: str) -> Path:
    return out_dir / f"{date}.json"


def write_daily_record(result: PnLResult, date: str, out_dir: Path) -> Path:
    """Append-only: writing the same date twice with identical content is a no-op; writing
    different content for an already-recorded date is a hard error (root CLAUDE.md rule 10:
    records are append-only and never edited retroactively)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = daily_file_path(out_dir, date)
    payload = {"date": date, **asdict(result)}
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if path.exists():
        existing = path.read_text()
        if existing == text:
            return path
        raise RuntimeError(
            f"{path} already exists with different content — daily records are append-only "
            "and never edited retroactively (root CLAUDE.md rule 10); this date's file must "
            "not change once written"
        )
    path.write_text(text)
    return path


def render_markdown(result: PnLResult, date: str) -> str:
    lines = [
        f"# P&L report — {date}",
        "",
        f"Source: `{result.source}` ({result.entry_count} decision(s)). "
        "Not yet reconciled against a venue statement (issue #45).",
        "",
        "## Agent (after fees)",
        f"- realized: ${result.agent['realized_pnl_usd']}",
        f"- fees paid: ${result.agent['fees_paid_usd']}",
        f"- unrealized: ${result.agent['unrealized_pnl_usd']}",
        f"- total: ${result.agent['total_pnl_after_fees_usd']}",
        "",
        "## Baselines",
        f"- no-trade: ${result.no_trade['total_pnl_usd']}",
    ]
    if result.buy_and_hold is not None:
        lines.append(f"- buy-and-hold: ${result.buy_and_hold['total_pnl_after_fees_usd']}")
    else:
        lines.append(
            "- buy-and-hold: not computed (agent never took a position to size it against)"
        )
    lines += [
        "",
        f"## Drawdown: ${result.max_drawdown_usd}",
        f"## AI cost: ${result.ai_cost_usd}",
        "",
        "## Stop rule",
        f"- triggered: {result.stop_rule['triggered']}",
    ]
    for reason in result.stop_rule["reasons"]:
        lines.append(f"  - {reason}")
    lines.append(f"- thresholds: {result.stop_rule['thresholds_source']}")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--date", type=str, default=None)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    entries = _load_entries(args.ledger)
    date = args.date
    if date is None:
        date = (
            _day(int(entries[-1]["request"]["ts_ns"]))
            if entries
            else dt.datetime.now(dt.UTC).date().isoformat()
        )

    result, _curve = build_report(args.ledger, args.policy)
    path = write_daily_record(result, date, args.out)
    print(render_markdown(result, date))
    print(f"(written to {path})")
    return 1 if result.stop_rule["triggered"] else 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
