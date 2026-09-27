//! `SimVenue` against a recorded fixture: every event it emits is pinned.

use qc_core::{
    ClientOrderId, Event, InstrumentId, OrderEvent, OrderRequest, OrderType, Price, Qty, Side,
    StrategyId, Timestamp, VenueId, VenueOrderId,
};
use qc_gateway::{GatewayError, SimVenue, VenueAdapter, record};

fn p(s: &str) -> Price {
    s.parse().unwrap()
}
fn q(s: &str) -> Qty {
    s.parse().unwrap()
}

fn order(id: u64, side: Side, order_type: OrderType, price: &str, qty: &str) -> OrderRequest {
    OrderRequest {
        client_id: ClientOrderId(id),
        strategy: StrategyId(1),
        instrument: InstrumentId(1),
        side,
        order_type,
        price: p(price),
        qty: q(qty),
    }
}

fn drain(v: &mut SimVenue) -> Vec<OrderEvent> {
    std::iter::from_fn(|| v.poll())
        .map(|e| match e {
            Event::Order(o) => o,
            Event::Market(m) => panic!("sim venue only emits order events, got {m:?}"),
        })
        .collect()
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one scripted session, read top to bottom"
)]
fn sim_venue_replays_the_fixture_session_exactly() {
    let records = record::parse(include_str!("fixtures/sim_session.csv")).unwrap();
    let mut v = SimVenue::new(VenueId(1), InstrumentId(1));
    let c = ClientOrderId;
    let t = Timestamp(1000);

    v.on_record(&records[0]);
    v.submit(&order(1, Side::Buy, OrderType::Limit, "100.2", "1.5"))
        .unwrap();
    assert_eq!(
        drain(&mut v),
        [
            OrderEvent::Accepted {
                client_id: c(1),
                venue_id: VenueOrderId(1),
                ts: t
            },
            OrderEvent::Filled {
                client_id: c(1),
                price: p("100.1"),
                qty: q("1"),
                ts: t
            },
            OrderEvent::Filled {
                client_id: c(1),
                price: p("100.2"),
                qty: q("0.5"),
                ts: t
            },
        ]
    );

    v.submit(&order(2, Side::Sell, OrderType::PostOnly, "100", "1"))
        .unwrap();
    v.submit(&order(3, Side::Buy, OrderType::Limit, "99.95", "0.5"))
        .unwrap();
    v.submit(&order(4, Side::Sell, OrderType::Ioc, "99.95", "3"))
        .unwrap();
    assert_eq!(
        drain(&mut v),
        [
            OrderEvent::Rejected {
                client_id: c(2),
                ts: t
            },
            OrderEvent::Accepted {
                client_id: c(3),
                venue_id: VenueOrderId(2),
                ts: t
            },
            OrderEvent::Accepted {
                client_id: c(4),
                venue_id: VenueOrderId(3),
                ts: t
            },
            OrderEvent::Filled {
                client_id: c(4),
                price: p("100"),
                qty: q("2"),
                ts: t
            },
            OrderEvent::Canceled {
                client_id: c(4),
                ts: t
            },
        ]
    );

    // A sell trade at 99.9 prints through the resting 99.95 bid: partial fill.
    v.on_record(&records[1]);
    let t2 = Timestamp(2000);
    assert_eq!(
        drain(&mut v),
        [OrderEvent::Filled {
            client_id: c(3),
            price: p("99.95"),
            qty: q("0.2"),
            ts: t2
        }]
    );

    v.cancel(c(3)).unwrap();
    v.cancel(c(3)).unwrap();
    assert_eq!(
        drain(&mut v),
        [
            OrderEvent::Canceled {
                client_id: c(3),
                ts: t2
            },
            OrderEvent::CancelRejected {
                client_id: c(3),
                ts: t2
            },
        ]
    );

    v.on_record(&records[2]);
    assert_eq!(v.book().best_ask(), Some((p("100.2"), q("3"))));

    v.set_connected(false);
    assert_eq!(
        v.submit(&order(5, Side::Buy, OrderType::Limit, "99", "1")),
        Err(GatewayError::Disconnected)
    );
    assert_eq!(v.cancel(c(1)), Err(GatewayError::Disconnected));
    v.set_connected(true);

    let snapshot = v.order_snapshot().unwrap();
    let summary: Vec<_> = snapshot
        .iter()
        .map(|o| (o.client_id.unwrap().0, o.open, o.filled))
        .collect();
    assert_eq!(
        summary,
        [
            (1, false, q("1.5")),
            (3, false, q("0.2")),
            (4, false, q("2"))
        ]
    );
}
