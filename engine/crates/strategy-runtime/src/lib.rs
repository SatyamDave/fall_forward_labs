//! The contract between the engine and a strategy.

use qc_core::{Event, OrderRequest};

/// A strategy turns events into order requests. It must be deterministic: the
/// same events in the same order produce the same requests. It pushes into
/// `out` rather than returning a `Vec` so the hot path does not allocate.
pub trait Strategy {
    fn on_event(&mut self, event: &Event, out: &mut Vec<OrderRequest>);
}

#[cfg(test)]
mod tests {
    use super::*;
    use qc_core::{ClientOrderId, OrderEvent, Timestamp};

    struct Quiet;
    impl Strategy for Quiet {
        fn on_event(&mut self, _: &Event, _: &mut Vec<OrderRequest>) {}
    }

    #[test]
    fn strategy_can_decline_to_trade() {
        let mut out = Vec::new();
        let event = Event::Order(OrderEvent::Canceled {
            client_id: ClientOrderId(1),
            ts: Timestamp(0),
        });
        Quiet.on_event(&event, &mut out);
        assert!(out.is_empty());
    }
}
