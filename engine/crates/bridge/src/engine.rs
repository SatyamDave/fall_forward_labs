//! The bridge's own engine loop: book + features + signal on one side, risk +
//! OMS + a [`SimVenue`] on the other. Unlike `qc_replay::Engine` there is no
//! [`qc_strategy_runtime::Strategy`]: the external agent decides, and every
//! decision it sends still goes through the same risk path a strategy would.
//!
//! Determinism: time comes only from recorded timestamps via [`SimClock`],
//! and record order is a `Vec`, never a `HashMap`.

use qc_core::{
    ClientOrderId, Clock, Event, InstrumentId, OrderEvent, OrderRequest, OrderType, Price, Qty,
    SCALE, Side, SimClock, StrategyId, VenueId,
};
use qc_gateway::{Record, SimVenue, VenueAdapter, record::parse as parse_records};
use qc_inference::features::{FeatureState, N_FEATURES, TopOfBook};
use qc_inference::{Direction, Model, Signal};
use qc_oms::Oms;
use qc_orderbook::{BookStatus, OrderBook};
use qc_risk::{KillSwitch, Limits, RiskCheck, RiskContext, RiskEngine, RiskReject};
use serde_json::{Map, Value, json};

/// The only instrument the v1 bridge trades, and its label on the wire.
pub const INSTRUMENT: InstrumentId = InstrumentId(1);
pub const INSTRUMENT_LABEL: &str = "1";
const BRIDGE_STRATEGY: StrategyId = StrategyId(1);

/// Snake-case wire name for a [`RiskReject`], used by `submit_order_intent`
/// and shared with tests that check exact rejection codes.
#[must_use]
pub fn risk_reject_code(reject: RiskReject) -> &'static str {
    match reject {
        RiskReject::KillSwitch => "kill_switch",
        RiskReject::InvalidOrder => "invalid_order",
        RiskReject::StaleData => "stale_data",
        RiskReject::MaxDailyLoss => "max_daily_loss",
        RiskReject::PriceBand => "price_band",
        RiskReject::SelfCross => "self_cross",
        RiskReject::MaxNotional => "max_notional",
        RiskReject::MaxDailyNotional => "max_daily_notional",
        RiskReject::MaxPosition => "max_position",
        RiskReject::WashTrade => "wash_trade",
        RiskReject::MaxOrderRate => "max_order_rate",
    }
}

/// A loaded model plus the hash the caller asserted for it, echoed on every signal.
pub struct LoadedModel {
    pub model: Box<dyn Model>,
    pub sha256: String,
}

pub struct BridgeEngine {
    book: OrderBook,
    tick: Price,
    features: FeatureState,
    last_features: Option<[f64; N_FEATURES]>,
    model: Option<LoadedModel>,
    risk: RiskEngine,
    oms: Oms,
    venue: SimVenue,
    clock: SimClock,
    position: Qty,
    /// Cash from fills, raw [`Price`] units, wide so it cannot overflow.
    cash: i128,
    /// Latches once the daily loss limit is reached; there is no reset (root rule: a
    /// human restarts the process, same as `qc_replay::Engine`'s halt).
    daily_loss_halted: bool,
    records: Vec<Record>,
    cursor: usize,
    decide_every: u32,
    since_last_decision: u32,
    decision_seq: u64,
    next_client_id: u64,
}

impl BridgeEngine {
    #[must_use]
    pub fn new(
        records: Vec<Record>,
        limits: Limits,
        kill_switch: KillSwitch,
        tick: Price,
        decide_every: u32,
        model: Option<LoadedModel>,
    ) -> Self {
        Self {
            book: OrderBook::new(INSTRUMENT),
            tick,
            features: FeatureState::new(tick),
            last_features: None,
            model,
            risk: RiskEngine::new(limits, kill_switch),
            oms: Oms::default(),
            venue: SimVenue::new(VenueId(1), INSTRUMENT),
            clock: SimClock::default(),
            position: Qty::ZERO,
            cash: 0,
            daily_loss_halted: false,
            records,
            cursor: 0,
            decide_every,
            since_last_decision: 0,
            decision_seq: 0,
            next_client_id: 0,
        }
    }

    /// Parses a recording in the `tests/replay` text format (shared with `qc_replay`).
    ///
    /// # Errors
    /// [`qc_gateway::record::ParseError`] on the first malformed line.
    pub fn load_recording(text: &str) -> Result<Vec<Record>, qc_gateway::record::ParseError> {
        parse_records(text)
    }

    fn daily_pnl(&self) -> Price {
        let mark = self.book.mid().map_or(0, |m| i128::from(m.raw()));
        let pnl = self.cash + i128::from(self.position.raw()) * mark / i128::from(SCALE);
        Price::from_raw(i64::try_from(pnl).unwrap_or(if pnl < 0 { i64::MIN } else { i64::MAX }))
    }

    fn check_daily_loss(&mut self) {
        if !self.daily_loss_halted && self.risk.daily_loss_reached(self.daily_pnl()) {
            self.daily_loss_halted = true;
        }
    }

    /// Remaining loss budget for the day: the limit, less any loss already
    /// booked. Profit never raises it past the configured limit.
    fn remaining_daily_loss(&self) -> Price {
        let max = i128::from(self.risk.limits().max_daily_loss.raw());
        let pnl = i128::from(self.daily_pnl().raw());
        let headroom = (max + pnl.min(0)).max(0);
        Price::from_raw(i64::try_from(headroom).unwrap_or(i64::MAX))
    }

    fn context(&self) -> RiskContext {
        let (mut open_buy, mut open_sell) = (0_i64, 0_i64);
        let (mut own_best_bid, mut own_best_ask) = (None, None);
        for o in self.oms.open_orders() {
            match o.request.side {
                Side::Buy => {
                    open_buy += o.open_qty().raw();
                    own_best_bid = Some(
                        own_best_bid.map_or(o.request.price, |b: Price| b.max(o.request.price)),
                    );
                }
                Side::Sell => {
                    open_sell += o.open_qty().raw();
                    own_best_ask = Some(
                        own_best_ask.map_or(o.request.price, |a: Price| a.min(o.request.price)),
                    );
                }
            }
        }
        RiskContext {
            now: self.clock.now(),
            last_market_data: self.book.last_update(),
            position: self.position,
            open_buy_qty: Qty::from_raw(open_buy),
            open_sell_qty: Qty::from_raw(open_sell),
            reference_price: self
                .book
                .mid()
                .filter(|_| self.book.status() == BookStatus::Synced),
            daily_pnl: self.daily_pnl(),
            own_best_bid,
            own_best_ask,
        }
    }

    /// Applies venue events (fills, acks) to the OMS and updates position and
    /// cash on fills. Mirrors `qc_replay::Engine::drain`'s fill bookkeeping.
    fn drain_venue_events(&mut self) {
        while let Some(event) = self.venue.poll() {
            let Event::Order(order_event) = event else {
                continue;
            };
            if self.oms.apply(&order_event).is_err() {
                // This process is the only client of this venue, so an
                // illegal event should never happen; skip it defensively
                // rather than letting a stdio bridge process panic.
                continue;
            }
            if let OrderEvent::Filled {
                client_id,
                price,
                qty,
                ts,
            } = order_event
                && let Some(order) = self.oms.get(client_id)
            {
                let notional = i128::from(price.raw()) * i128::from(qty.raw()) / i128::from(SCALE);
                let (dq, dc) = match order.request.side {
                    Side::Buy => (qty.raw(), -notional),
                    Side::Sell => (-qty.raw(), notional),
                };
                self.position = Qty::from_raw(self.position.raw() + dq);
                self.cash += dc;
                // #40: a wash-trade pattern is about completed trades, not merely
                // accepted-then-canceled quotes, so this is fed on fill, not on submit.
                self.risk
                    .record_fill(order.request.instrument, order.request.side, price, qty, ts);
            }
        }
        self.check_daily_loss();
    }

    fn update_features_and_signal(&mut self) {
        let synced = self.book.status() == BookStatus::Synced;
        let sides = synced
            .then(|| self.book.best_bid().zip(self.book.best_ask()))
            .flatten();
        let Some(((bid_px, bid_qty), (ask_px, ask_qty))) = sides else {
            // Out of sync or one-sided: restart the warmup window rather than
            // bridging a feature update across a gap the book itself resyncs from.
            self.features = FeatureState::new(self.tick);
            self.last_features = None;
            return;
        };
        let tob = TopOfBook {
            bid_px,
            bid_qty,
            ask_px,
            ask_qty,
        };
        self.last_features = self.features.update(tob);
    }

    fn process_record(&mut self, record: &Record) {
        self.clock.advance_to(record.ts_local());
        self.venue.on_record(record);
        match record {
            Record::Snapshot(s) => {
                let _ = self.book.apply_snapshot(s);
                self.since_last_decision += 1;
            }
            Record::Market(qc_core::MarketEvent::BookDelta(d)) => {
                let _ = self.book.apply(d);
                self.since_last_decision += 1;
            }
            Record::Market(qc_core::MarketEvent::Trade(_)) => {}
        }
        self.drain_venue_events();
        self.update_features_and_signal();
    }

    fn ready_to_decide(&self) -> bool {
        self.book.status() == BookStatus::Synced
            && self.book.best_bid().is_some()
            && self.book.best_ask().is_some()
            && self.since_last_decision >= self.decide_every
    }

    fn signal_json(&self) -> Option<Value> {
        let model = self.model.as_ref()?;
        let features = self.last_features?;
        let signal: Signal = model.model.predict(&features)?;
        let direction = match signal.direction {
            Direction::Up => "up",
            Direction::Flat => "flat",
            Direction::Down => "down",
        };
        Some(json!({
            "direction": direction,
            "probs": signal.probs,
            "model_sha256": model.sha256,
        }))
    }

    fn features_json(&self) -> Value {
        let map: Map<String, Value> = self.last_features.map_or_else(Map::new, |f| {
            qc_inference::features::FEATURE_NAMES
                .iter()
                .zip(f)
                .map(|(name, v)| ((*name).to_owned(), json!(v)))
                .collect()
        });
        Value::Object(map)
    }

    fn build_decision_request(&mut self) -> Value {
        self.decision_seq += 1;
        let (bid_px, _) = self.book.best_bid().expect("caller checked readiness");
        let (ask_px, _) = self.book.best_ask().expect("caller checked readiness");
        let mid = self.book.mid().expect("both sides present when ready");
        let spread_ticks = if self.tick.raw() > 0 {
            ((ask_px.raw() - bid_px.raw()) / self.tick.raw()).max(0)
        } else {
            0
        };
        let limits = self.risk.limits();
        json!({
            "request_id": format!("dr-{}", self.decision_seq),
            "ts_ns": self.clock.now().0,
            "instrument": INSTRUMENT_LABEL,
            "best_bid": bid_px.to_string(),
            "best_ask": ask_px.to_string(),
            "mid": mid.to_string(),
            "spread_ticks": spread_ticks,
            "features": self.features_json(),
            "signal": self.signal_json(),
            "position": self.position.to_string(),
            "limits": {
                "max_position": limits.max_position.to_string(),
                "max_notional": limits.max_notional.to_string(),
                "max_order_rate_per_sec": limits.max_order_rate_per_sec,
                "remaining_daily_loss": self.remaining_daily_loss().to_string(),
            },
            "allowed_actions": ["buy", "sell", "no_trade"],
        })
    }

    /// Advances the feed until the book is ready for a decision, or the
    /// recording is exhausted (`None`).
    pub fn next_decision_request(&mut self) -> Option<Value> {
        while self.cursor < self.records.len() {
            let record = self.records[self.cursor].clone();
            self.cursor += 1;
            self.process_record(&record);
            if self.ready_to_decide() {
                self.since_last_decision = 0;
                return Some(self.build_decision_request());
            }
        }
        None
    }

    /// Runs the same risk path `qc_replay::Engine` runs before every order,
    /// then records to the OMS and routes to the venue. Never routes an
    /// order that failed a check.
    pub fn submit_order_intent(
        &mut self,
        side: Side,
        qty: Qty,
        limit_price: Price,
        time_in_force: OrderType,
    ) -> Value {
        if self.risk.kill_switch().is_engaged() {
            return json!({"accepted": false, "halted": "kill_switch"});
        }
        if self.daily_loss_halted {
            return json!({"accepted": false, "halted": "max_daily_loss"});
        }
        self.next_client_id += 1;
        let client_id = ClientOrderId(self.next_client_id);
        let order = OrderRequest {
            client_id,
            strategy: BRIDGE_STRATEGY,
            instrument: INSTRUMENT,
            side,
            order_type: time_in_force,
            price: limit_price,
            qty,
        };
        let ctx = self.context();
        if let Err(reject) = self.risk.check(&order, &ctx) {
            return match reject {
                RiskReject::KillSwitch => json!({"accepted": false, "halted": "kill_switch"}),
                RiskReject::MaxDailyLoss => {
                    self.daily_loss_halted = true;
                    json!({"accepted": false, "halted": "max_daily_loss"})
                }
                other => json!({"accepted": false, "risk_reject": risk_reject_code(other)}),
            };
        }
        if self.oms.insert(order).is_err() {
            return json!({"accepted": false, "risk_reject": "invalid_order"});
        }
        if self.venue.submit(&order).is_ok() {
            self.drain_venue_events();
            return json!({"accepted": true, "client_order_id": client_id.0});
        }
        let rejected = OrderEvent::Rejected {
            client_id,
            ts: self.clock.now(),
        };
        let _ = self.oms.apply(&rejected);
        json!({"accepted": false, "risk_reject": "invalid_order"})
    }

    #[must_use]
    pub fn status(&self) -> Value {
        let open_orders: Vec<Value> = self
            .oms
            .open_orders()
            .map(|o| {
                json!({
                    "client_order_id": o.request.client_id.0,
                    "side": match o.request.side { Side::Buy => "buy", Side::Sell => "sell" },
                    "price": o.request.price.to_string(),
                    "qty": o.request.qty.to_string(),
                    "filled": o.filled.to_string(),
                })
            })
            .collect();
        let halted = if self.risk.kill_switch().is_engaged() {
            Some("kill_switch")
        } else if self.daily_loss_halted {
            Some("max_daily_loss")
        } else {
            None
        };
        let limits = self.risk.limits();
        json!({
            "position": self.position.to_string(),
            "halted": halted,
            "open_orders": open_orders,
            "limits": {
                "max_position": limits.max_position.to_string(),
                "max_notional": limits.max_notional.to_string(),
                "max_order_rate_per_sec": limits.max_order_rate_per_sec,
                "remaining_daily_loss": self.remaining_daily_loss().to_string(),
            },
        })
    }
}
