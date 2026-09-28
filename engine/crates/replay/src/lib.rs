//! Replays recorded events through a strategy. Rule 7: the same recording must
//! produce the same orders, so this module owns the determinism check.

use qc_core::{Event, OrderRequest};
use qc_strategy_runtime::Strategy;

/// Feeds `events` to `strategy` in order and returns every order it asked for.
pub fn run<S: Strategy>(
    strategy: &mut S,
    events: impl IntoIterator<Item = Event>,
) -> Vec<OrderRequest> {
    let mut orders = Vec::new();
    for event in events {
        strategy.on_event(&event, &mut orders);
    }
    orders
}

#[cfg(test)]
mod tests {
    use super::*;
    use qc_core::{
        ClientOrderId, InstrumentId, MarketEvent, OrderType, Price, Qty, Side, StrategyId,
        Timestamp, Trade,
    };

    /// Buys one unit at each trade price.
    #[derive(Default)]
    struct Echo {
        next_id: u64,
    }

    impl Strategy for Echo {
        fn on_event(&mut self, event: &Event, out: &mut Vec<OrderRequest>) {
            if let Event::Market(MarketEvent::Trade(t)) = event {
                self.next_id += 1;
                out.push(OrderRequest {
                    client_id: ClientOrderId(self.next_id),
                    strategy: StrategyId(1),
                    instrument: t.instrument,
                    side: Side::Buy,
                    order_type: OrderType::Limit,
                    price: t.price,
                    qty: Qty::from_raw(1),
                });
            }
        }
    }

    #[test]
    fn two_replays_of_one_recording_match() {
        let day: Vec<Event> = (1..=3)
            .map(|i| {
                Event::Market(MarketEvent::Trade(Trade {
                    instrument: InstrumentId(7),
                    aggressor: Side::Sell,
                    price: Price::from_raw(100 + i),
                    qty: Qty::from_raw(1),
                    ts_exchange: Timestamp(i.unsigned_abs()),
                    ts_local: Timestamp(i.unsigned_abs()),
                }))
            })
            .collect();
        let first = run(&mut Echo::default(), day.clone());
        assert_eq!(first.len(), 3);
        assert_eq!(first, run(&mut Echo::default(), day));
    }
}
