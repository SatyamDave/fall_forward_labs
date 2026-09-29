#!/usr/bin/env python3
"""Progress of the live account: capital, confirmed P&L, decision counts, today's risk budget.

  scripts/reports/progress_report.py [--ledger PATH] [--broker-journal PATH]
      [--reconcile-status PATH] [--policy PATH] [--limits PATH] [--date YYYY-MM-DD]

Prints a short markdown summary to stdout and writes nothing. Only `mode: "live"` ledger entries
count; fake/replay entries are excluded and their count is shown.

- Starting capital and the $5,000 target come from `[account]` in pnl_policy.toml.
- Current equity needs a broker-confirmed cash + position snapshot. The reconcile status file
  (agent/src/broker/reconcile.ts) records only a verdict, so equity is reported UNKNOWN until
  such a snapshot is recorded; progress toward the target is then UNKNOWN too. Never projected.
- P&L uses pnl_report.py's broker fill resolver: only orders the broker journal resolved to a
  real fill count. An accepted intent without a resolved fill is not a fill. Fees are
  pnl_policy.toml's assumed fee_bps, not broker-reported, and are already inside realized P&L.
  Unrealized P&L is marked at the last live request's mid (engine market data, not the broker).
- Today's budget uses the engine's own day bucketing (UTC, ts_ns // one day): notional is the
  sum of accepted orders' qty * limit_price, loss is max_daily_loss minus the last live request's
  engine-reported `limits.remaining_daily_loss`.

Standard library only, matching the other scripts in scripts/reports.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import tomllib
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ledger_report
import pnl_report

ROOT = pnl_report.ROOT
DEFAULT_RECONCILE_STATUS = ROOT / "ops/live/state/reconcile-status.json"
# The only configured instrument (config/instruments/spy.toml -> ../limits/spy.toml).
DEFAULT_LIMITS = ROOT / "config/limits/spy.toml"
NANOS_PER_DAY = 86_400_000_000_000
UNKNOWN_EQUITY = "UNKNOWN (no reconciled position/cash snapshot)"
HOLD_REASONS = ("null_signal", "model_error", "explicit_hold", "unclassified")

# The OpenRouter decider's own fallback reasons (agent/src/decider/openrouter.ts noTrade()):
# transport and parse failures only, so a model's own "openrouter: ..." wording is not matched.
MODEL_ERROR_RATIONALE = re.compile(
    r"^openrouter: (HTTP \d{3}|request failed:|non-JSON decision:|schema-invalid:)"
)


def classify_hold(entry: dict[str, Any]) -> str:
    """Why a no_trade was recorded. Model error wins over a null signal: a failed model call on a
    request with no signal still failed."""
    raw = entry.get("raw")
    rationale = str(entry.get("decision", {}).get("rationale") or "")
    if (isinstance(raw, dict) and isinstance(raw.get("no_trade_reason"), str)) or (
        MODEL_ERROR_RATIONALE.match(rationale)
    ):
        return "model_error"
    request = entry.get("request", {})
    if "signal" in request and request["signal"] is None:
        return "null_signal"
    if not rationale.strip():
        return "unclassified"
    return "explicit_hold"


def _day_of(entry: dict[str, Any]) -> str:
    return pnl_report._day(int(entry.get("request", {}).get("ts_ns", 0)))


def build_progress(
    entries: list[dict[str, Any]],
    journal: dict[str, dict[str, Any]],
    policy: dict[str, Any],
    limits: dict[str, Any],
    reconcile_status: dict[str, Any] | None,
    today: str,
) -> dict[str, Any]:
    live = [e for e in entries if e.get("mode") == "live"]
    excluded = Counter(str(e.get("mode", "missing")) for e in entries if e.get("mode") != "live")

    intents = [e for e in live if e.get("decision", {}).get("action") in ("buy", "sell")]
    results = [e.get("result") for e in intents]
    accepted = [e for e in intents if pnl_report._is_accepted_trade(e)]
    rejected = [r for r in results if isinstance(r, dict) and r.get("accepted") is False]
    holds = Counter(
        classify_hold(e) for e in live if e.get("decision", {}).get("action") == "no_trade"
    )

    fee_bps = Decimal(str(policy["fees"]["fee_bps"]))
    pnl, _curve = pnl_report.compute(live, fee_bps, pnl_report.make_broker_fill_resolver(journal))
    realized = Decimal(pnl.agent["realized_pnl_usd"])  # already net of fees (apply_fill)
    unrealized = Decimal(pnl.agent["unrealized_pnl_usd"])

    # ponytail: no broker cash/position snapshot is recorded anywhere yet, so equity is always
    # None; read one here once reconcile.ts persists the snapshot it already fetches.
    equity: Decimal | None = None
    target = Decimal(str(policy["account"]["target_equity_usd"]))

    todays = [e for e in live if _day_of(e) == today]
    notional_used = sum(
        (
            Decimal(str(e["decision"]["qty"])) * Decimal(str(e["decision"]["limit_price"]))
            for e in accepted
            if _day_of(e) == today
        ),
        Decimal(0),
    )
    notional_cap = Decimal(str(limits["max_daily_notional"]))
    loss_cap = Decimal(str(limits["max_daily_loss"]))
    remaining_loss = None
    if todays:
        value = todays[-1].get("request", {}).get("limits", {}).get("remaining_daily_loss")
        remaining_loss = Decimal(str(value)) if value is not None else None

    return {
        "today": today,
        "live_decisions": len(live),
        "excluded_by_mode": dict(sorted(excluded.items())),
        "starting_capital_usd": str(policy["account"]["starting_capital_usd"]),
        "equity_usd": str(equity) if equity is not None else UNKNOWN_EQUITY,
        "reconcile_status": reconcile_status,
        "realized_pnl_after_fees_usd": str(realized),
        "fees_usd": pnl.agent["fees_paid_usd"],
        "unrealized_pnl_usd": str(unrealized),
        "counts": {
            "decisions": len(live),
            "proposed_orders": len(intents),
            "risk_accepted": len(accepted),
            "risk_rejected": len(rejected),
            "risk_rejected_halted": sum(1 for r in rejected if "halted" in r),
            "broker_confirmed_fills": pnl.fills["matched_fills"],
            "holds": {k: holds.get(k, 0) for k in HOLD_REASONS},
        },
        "risk_budget_today": {
            "notional_used_usd": str(notional_used),
            "notional_cap_usd": str(notional_cap),
            "notional_remaining_usd": str(notional_cap - notional_used),
            "loss_used_usd": str(loss_cap - remaining_loss) if remaining_loss is not None else None,
            "loss_cap_usd": str(loss_cap),
            "loss_remaining_usd": str(remaining_loss) if remaining_loss is not None else None,
        },
        "target_equity_usd": str(target),
        "progress_fraction": str(equity / target) if equity else None,
        "multiple_needed": str(target / equity) if equity else None,
    }


def render_markdown(p: dict[str, Any]) -> str:
    c, b = p["counts"], p["risk_budget_today"]
    unknown = "UNKNOWN"
    excluded = ", ".join(f"{m}={n}" for m, n in p["excluded_by_mode"].items()) or "none"
    rs = p["reconcile_status"]
    reconcile = (
        "no reconcile status file"
        if rs is None
        else f"ok={rs.get('ok')} ts_ns={rs.get('ts_ns')} discrepancies={rs.get('discrepancies')}"
    )
    lines = [
        f"# Live account progress ({p['today']}, UTC)",
        "",
        f"Live entries: {p['live_decisions']}. Excluded non-live entries: {excluded}.",
        "",
        "## Capital",
        f"- starting capital: ${p['starting_capital_usd']}",
        f"- current equity: {p['equity_usd']}",
        f"- last reconcile: {reconcile}",
        "",
        "## P&L (broker-confirmed fills only)",
        f"- realized after fees: ${p['realized_pnl_after_fees_usd']} "
        f"(assumed fees ${p['fees_usd']} included)",
        f"- unrealized: ${p['unrealized_pnl_usd']} (marked at the last live request's mid)",
        "",
        "## Counts",
        f"- decisions: {c['decisions']}",
        f"- proposed orders (intents): {c['proposed_orders']}",
        f"- risk-accepted: {c['risk_accepted']}",
        f"- risk-rejected: {c['risk_rejected']} (of which halted: {c['risk_rejected_halted']})",
        f"- broker-confirmed fills: {c['broker_confirmed_fills']}",
        "- holds: " + ", ".join(f"{k}={v}" for k, v in c["holds"].items()),
        "",
        "## Today's risk budget",
        f"- notional: used ${b['notional_used_usd']} of ${b['notional_cap_usd']}, "
        f"remaining ${b['notional_remaining_usd']}",
        f"- loss: used ${b['loss_used_usd'] or unknown} of ${b['loss_cap_usd']}, "
        f"remaining ${b['loss_remaining_usd'] or unknown}"
        + ("" if b["loss_used_usd"] is not None else " (no live request today)"),
        "",
        f"## Target: ${p['target_equity_usd']}",
        f"- progress (equity / target): {p['progress_fraction'] or unknown}",
        f"- multiple still needed: {p['multiple_needed'] or unknown}",
        "",
    ]
    return "\n".join(lines)


def _load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as f:
        return tomllib.load(f)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ledger", type=Path, default=pnl_report.DEFAULT_LEDGER)
    parser.add_argument("--broker-journal", type=Path, default=pnl_report.DEFAULT_BROKER_JOURNAL)
    parser.add_argument("--reconcile-status", type=Path, default=DEFAULT_RECONCILE_STATUS)
    parser.add_argument("--policy", type=Path, default=pnl_report.DEFAULT_POLICY)
    parser.add_argument("--limits", type=Path, default=DEFAULT_LIMITS)
    parser.add_argument("--date", default=dt.datetime.now(dt.UTC).date().isoformat())
    args = parser.parse_args(argv)

    entries, malformed = ledger_report._load_entries(args.ledger)
    status = (
        json.loads(args.reconcile_status.read_text()) if args.reconcile_status.exists() else None
    )
    progress = build_progress(
        entries,
        pnl_report.load_broker_journal(args.broker_journal),
        _load_toml(args.policy),
        _load_toml(args.limits),
        status,
        args.date,
    )
    print(render_markdown(progress))
    if malformed:
        print(f"({malformed} malformed ledger line(s) skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
