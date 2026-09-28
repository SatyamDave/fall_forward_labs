//! Pre-trade risk. Protected zone: changes need human approval, and no change
//! may loosen a limit or add a bypass.

use qc_core::{OrderRequest, Price, Qty, Timestamp};
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
    pub now: Timestamp,
    pub last_market_data: Timestamp,
    pub position: Qty,
    /// Reference price for the fat-finger band, usually the mid.
    pub reference_price: Price,
    pub daily_pnl: Price,
    pub orders_in_last_sec: u32,
    pub kill_switch: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskReject {
    KillSwitch,
    StaleData,
    MaxPosition,
    MaxNotional,
    MaxOrderRate,
    MaxDailyLoss,
    PriceBand,
}

/// Runs before every order. There is no way to skip it.
pub trait RiskCheck {
    /// # Errors
    /// Returns the first [`RiskReject`] the order violates.
    fn check(&self, order: &OrderRequest, ctx: &RiskContext) -> Result<(), RiskReject>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_limits_file_parses_and_rejects_unknown_keys() {
        let text = include_str!("../../../../config/limits/default.toml");
        let limits: Limits = toml::from_str(text).unwrap();
        assert!(limits.max_position > Qty::ZERO);
        assert!(limits.max_notional > Price::ZERO);
        assert!(toml::from_str::<Limits>(&format!("{text}\nmax_leverage = 100\n")).is_err());
    }
}
