//! Pre-trade risk. Protected zone: changes need human approval, and no change
//! may loosen a limit or add a bypass. This crate has no cargo features on
//! purpose: there is no build in which the checks are off.
//!
//! Every check and its boundary, in the order [`RiskEngine::check`] runs them:
//! 1. kill switch engaged: reject. Checked before anything else.
//! 2. price or quantity not positive: reject.
//! 3. stale data: age `now - last_market_data` equal to `stale_data_ms` passes, one ns more fails.
//! 4. daily loss: `daily_pnl <= -max_daily_loss` fails, so reaching the limit halts; one unit less loss passes.
//! 5. price band: `|price - reference| * 10_000 <= price_band_bps * reference` passes; no reference fails.
//! 6. notional: `price * qty <= max_notional` passes; overflow fails.
//! 7. position: worst-case position if every open order on the order's side and
//!    this order fill, `|position + open same-side + qty| <= max_position` passes.
//! 8. order rate: at most `max_order_rate_per_sec` passed orders in any window
//!    `(now - 1 s, now]`; the order that would be one more fails.
//!
//! Only an order that passes every check counts toward the rate window.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use qc_core::{OrderRequest, Price, Qty, Side, Timestamp};
use serde::Deserialize;

/// Per-strategy limits, loaded from `config/limits/*.toml`. Unknown keys are an
/// error so a misspelled limit cannot be silently ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    /// Largest absolute position per instrument, in base units.
    pub max_position: Qty,
    /// Largest notional of a single order, in quote currency.
    pub max_notional: Price,
    pub max_order_rate_per_sec: u32,
    /// Realized plus unrealized loss for the day that halts trading, as a positive amount.
    pub max_daily_loss: Price,
    /// Largest distance of an order price from the reference price, in basis points.
    pub price_band_bps: u32,
    /// Market data older than this halts order entry.
    pub stale_data_ms: u64,
}

/// What a check needs to know about the world when an order is proposed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RiskContext {
    /// From the engine's [`qc_core::Clock`], so replay drives the rate window deterministically.
    pub now: Timestamp,
    pub last_market_data: Timestamp,
    /// Signed position in the order's instrument.
    pub position: Qty,
    /// Unfilled quantity of our working buy orders in the instrument.
    pub open_buy_qty: Qty,
    /// Unfilled quantity of our working sell orders in the instrument (positive).
    pub open_sell_qty: Qty,
    /// Reference price for the fat-finger band, usually the mid. `None` rejects.
    pub reference_price: Option<Price>,
    pub daily_pnl: Price,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskReject {
    KillSwitch,
    InvalidOrder,
    StaleData,
    MaxDailyLoss,
    PriceBand,
    MaxNotional,
    MaxPosition,
    MaxOrderRate,
}

/// Global kill switch. Clones share one flag, so any thread (an operator
/// command, a watchdog) can halt every engine that holds a clone. There is no
/// reset: clearing it means restarting the process, a human decision.
#[derive(Debug, Clone, Default)]
pub struct KillSwitch(Arc<AtomicBool>);

impl KillSwitch {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn engage(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    #[must_use]
    pub fn is_engaged(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Runs before every order. There is no way to skip it.
pub trait RiskCheck {
    /// Checks the order and, if it passes, counts it toward the rate limit.
    ///
    /// # Errors
    /// Returns the first [`RiskReject`] the order violates.
    fn check(&mut self, order: &OrderRequest, ctx: &RiskContext) -> Result<(), RiskReject>;
}

const NANOS_PER_MS: u64 = 1_000_000;
const NANOS_PER_SEC: u64 = 1_000_000_000;

#[derive(Debug)]
pub struct RiskEngine {
    limits: Limits,
    kill_switch: KillSwitch,
    /// Times of passed orders inside the current one-second window, oldest first.
    /// Capacity is the rate limit, reserved up front so a check never allocates.
    recent: VecDeque<Timestamp>,
}

impl RiskEngine {
    #[must_use]
    pub fn new(limits: Limits, kill_switch: KillSwitch) -> Self {
        let recent = VecDeque::with_capacity(limits.max_order_rate_per_sec as usize);
        Self {
            limits,
            kill_switch,
            recent,
        }
    }

    #[must_use]
    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    #[must_use]
    pub fn kill_switch(&self) -> &KillSwitch {
        &self.kill_switch
    }

    /// Whether `daily_pnl` is at or past the loss limit, the boundary of check 4.
    /// The engine also asks this after fills, so resting orders cannot run past it.
    #[must_use]
    pub fn daily_loss_reached(&self, daily_pnl: Price) -> bool {
        i128::from(daily_pnl.raw()) <= -i128::from(self.limits.max_daily_loss.raw())
    }

    fn check_static(&self, order: &OrderRequest, ctx: &RiskContext) -> Result<(), RiskReject> {
        let l = &self.limits;
        if order.price <= Price::ZERO || order.qty <= Qty::ZERO {
            return Err(RiskReject::InvalidOrder);
        }
        let age = ctx.now.saturating_since(ctx.last_market_data);
        if age > l.stale_data_ms.saturating_mul(NANOS_PER_MS) {
            return Err(RiskReject::StaleData);
        }
        if self.daily_loss_reached(ctx.daily_pnl) {
            return Err(RiskReject::MaxDailyLoss);
        }
        let reference = ctx
            .reference_price
            .filter(|r| *r > Price::ZERO)
            .ok_or(RiskReject::PriceBand)?;
        let distance = (i128::from(order.price.raw()) - i128::from(reference.raw())).abs();
        if distance * 10_000 > i128::from(l.price_band_bps) * i128::from(reference.raw()) {
            return Err(RiskReject::PriceBand);
        }
        match order.price.notional(order.qty) {
            Some(n) if n <= l.max_notional => {}
            Some(_) | None => return Err(RiskReject::MaxNotional),
        }
        let pos = i128::from(ctx.position.raw());
        let qty = i128::from(order.qty.raw());
        let worst = match order.side {
            Side::Buy => pos + i128::from(ctx.open_buy_qty.raw()) + qty,
            Side::Sell => pos - i128::from(ctx.open_sell_qty.raw()) - qty,
        };
        if worst.abs() > i128::from(l.max_position.raw()) {
            return Err(RiskReject::MaxPosition);
        }
        Ok(())
    }
}

impl RiskCheck for RiskEngine {
    fn check(&mut self, order: &OrderRequest, ctx: &RiskContext) -> Result<(), RiskReject> {
        if self.kill_switch.is_engaged() {
            return Err(RiskReject::KillSwitch);
        }
        self.check_static(order, ctx)?;
        let window_start = ctx.now.0.saturating_sub(NANOS_PER_SEC);
        while self.recent.front().is_some_and(|t| t.0 <= window_start) {
            self.recent.pop_front();
        }
        if self.recent.len() >= self.limits.max_order_rate_per_sec as usize {
            return Err(RiskReject::MaxOrderRate);
        }
        self.recent.push_back(ctx.now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use qc_core::{ClientOrderId, InstrumentId, OrderType, StrategyId};

    fn limits() -> Limits {
        toml::from_str(include_str!("../../../../config/limits/default.toml")).unwrap()
    }

    fn p(s: &str) -> Price {
        s.parse().unwrap()
    }

    fn q(s: &str) -> Qty {
        s.parse().unwrap()
    }

    const SEC: u64 = 1_000_000_000;

    /// Defaults: `max_position` 0.01, `max_notional` 500, 5 orders/s, `max_daily_loss` 100,
    /// band 50 bps, stale 1000 ms. The base order is well inside every limit.
    fn order(side: Side, price: &str, qty: &str) -> OrderRequest {
        OrderRequest {
            client_id: ClientOrderId(1),
            strategy: StrategyId(1),
            instrument: InstrumentId(1),
            side,
            order_type: OrderType::Limit,
            price: p(price),
            qty: q(qty),
        }
    }

    fn ctx() -> RiskContext {
        RiskContext {
            now: Timestamp(10 * SEC),
            last_market_data: Timestamp(10 * SEC),
            position: Qty::ZERO,
            open_buy_qty: Qty::ZERO,
            open_sell_qty: Qty::ZERO,
            reference_price: Some(p("10000")),
            daily_pnl: Price::ZERO,
        }
    }

    fn engine() -> RiskEngine {
        RiskEngine::new(limits(), KillSwitch::new())
    }

    fn check(o: &OrderRequest, c: &RiskContext) -> Result<(), RiskReject> {
        engine().check(o, c)
    }

    #[test]
    fn default_limits_file_parses_and_rejects_unknown_keys() {
        let text = include_str!("../../../../config/limits/default.toml");
        let limits: Limits = toml::from_str(text).unwrap();
        assert!(limits.max_position > Qty::ZERO);
        assert!(limits.max_notional > Price::ZERO);
        assert!(toml::from_str::<Limits>(&format!("{text}\nmax_leverage = 100\n")).is_err());
    }

    #[test]
    fn crate_has_no_features_that_could_switch_checks_off() {
        assert!(!include_str!("../Cargo.toml").contains("[features]"));
    }

    #[test]
    fn kill_switch_is_checked_first_and_shared_across_clones() {
        let mut risk = engine();
        let remote = risk.kill_switch().clone();
        let good = order(Side::Buy, "10000", "0.001");
        assert_eq!(risk.check(&good, &ctx()), Ok(()));
        remote.engage();
        assert_eq!(risk.check(&good, &ctx()), Err(RiskReject::KillSwitch));
        // Even an order that breaks every other limit reports the kill switch.
        let mut awful = ctx();
        awful.last_market_data = Timestamp(0);
        awful.daily_pnl = p("-1000");
        assert_eq!(
            risk.check(&order(Side::Buy, "0", "0"), &awful),
            Err(RiskReject::KillSwitch)
        );
    }

    #[test]
    fn invalid_orders_are_rejected() {
        for (price, qty) in [("0", "0.001"), ("10000", "0"), ("10000", "-0.001")] {
            assert_eq!(
                check(&order(Side::Buy, price, qty), &ctx()),
                Err(RiskReject::InvalidOrder)
            );
        }
    }

    #[test]
    fn stale_data_boundary() {
        let o = order(Side::Buy, "10000", "0.001");
        let mut c = ctx();
        c.last_market_data = Timestamp(c.now.0 - 1000 * 1_000_000);
        assert_eq!(check(&o, &c), Ok(()), "exactly stale_data_ms old passes");
        c.last_market_data.0 -= 1;
        assert_eq!(check(&o, &c), Err(RiskReject::StaleData));
        c.last_market_data = Timestamp(0);
        assert_eq!(
            check(&o, &c),
            Err(RiskReject::StaleData),
            "no data at all is stale"
        );
    }

    #[test]
    fn daily_loss_boundary() {
        let o = order(Side::Buy, "10000", "0.001");
        let mut c = ctx();
        c.daily_pnl = Price::from_raw(-p("100").raw() + 1);
        assert_eq!(check(&o, &c), Ok(()), "one unit short of the loss passes");
        c.daily_pnl = p("-100");
        assert_eq!(
            check(&o, &c),
            Err(RiskReject::MaxDailyLoss),
            "reaching the loss halts"
        );
        c.daily_pnl = p("-100.00000001");
        assert_eq!(check(&o, &c), Err(RiskReject::MaxDailyLoss));
    }

    #[test]
    fn price_band_boundary() {
        // 50 bps of 10000 is 50.
        for (price, ok) in [
            ("10050", true),
            ("10050.00000001", false),
            ("9950", true),
            ("9949.99999999", false),
        ] {
            let got = check(&order(Side::Sell, price, "0.001"), &ctx());
            assert_eq!(got.is_ok(), ok, "{price}: {got:?}");
            if !ok {
                assert_eq!(got, Err(RiskReject::PriceBand));
            }
        }
        let mut c = ctx();
        c.reference_price = None;
        assert_eq!(
            check(&order(Side::Buy, "10000", "0.001"), &c),
            Err(RiskReject::PriceBand)
        );
    }

    #[test]
    fn notional_boundary() {
        let mut c = ctx();
        c.reference_price = Some(p("50000"));
        // 50000 * 0.01 = 500 exactly; position limit is also 0.01, so both are at the edge.
        assert_eq!(check(&order(Side::Buy, "50000", "0.01"), &c), Ok(()));
        assert_eq!(
            check(&order(Side::Buy, "50000.00000100", "0.01"), &c),
            Err(RiskReject::MaxNotional)
        );
        c.reference_price = Some(Price::from_raw(i64::MAX / 2));
        assert_eq!(
            check(
                &order(
                    Side::Buy,
                    &Price::from_raw(i64::MAX / 2).to_string(),
                    "1000"
                ),
                &c
            ),
            Err(RiskReject::MaxNotional),
            "overflow rejects"
        );
    }

    #[test]
    fn position_boundary_counts_open_orders_on_the_same_side() {
        let mut c = ctx();
        c.position = q("0.005");
        c.open_buy_qty = q("0.004");
        assert_eq!(check(&order(Side::Buy, "10000", "0.001"), &c), Ok(()));
        assert_eq!(
            check(&order(Side::Buy, "10000", "0.00100001"), &c),
            Err(RiskReject::MaxPosition)
        );
        // Selling reduces a long, so it passes even though buys are at the limit.
        assert_eq!(check(&order(Side::Sell, "10000", "0.01"), &c), Ok(()));
        c.position = q("-0.005");
        c.open_sell_qty = q("0.005");
        assert_eq!(
            check(&order(Side::Sell, "10000", "0.00000001"), &c),
            Err(RiskReject::MaxPosition)
        );
        c.open_sell_qty = q("0.004");
        assert_eq!(check(&order(Side::Sell, "10000", "0.001"), &c), Ok(()));
    }

    #[test]
    fn order_rate_boundary_uses_a_sliding_one_second_window() {
        let mut risk = engine();
        let o = order(Side::Buy, "10000", "0.001");
        let at = |ns: u64| {
            let mut c = ctx();
            c.now = Timestamp(ns);
            c.last_market_data = Timestamp(ns);
            c
        };
        let t0 = 10 * SEC;
        for i in 0..5 {
            assert_eq!(risk.check(&o, &at(t0 + i)), Ok(()), "order {i} of 5");
        }
        assert_eq!(risk.check(&o, &at(t0 + 5)), Err(RiskReject::MaxOrderRate));
        // The first order leaves the window exactly 1 s after it passed.
        assert_eq!(
            risk.check(&o, &at(t0 + SEC - 1)),
            Err(RiskReject::MaxOrderRate)
        );
        assert_eq!(risk.check(&o, &at(t0 + SEC)), Ok(()));
        assert_eq!(risk.check(&o, &at(t0 + SEC)), Err(RiskReject::MaxOrderRate));
    }

    #[test]
    fn rejected_orders_do_not_use_up_the_rate_limit() {
        let mut risk = engine();
        let bad = order(Side::Buy, "20000", "0.001");
        for _ in 0..10 {
            assert_eq!(risk.check(&bad, &ctx()), Err(RiskReject::PriceBand));
        }
        for _ in 0..5 {
            assert_eq!(
                risk.check(&order(Side::Buy, "10000", "0.001"), &ctx()),
                Ok(())
            );
        }
    }
}
