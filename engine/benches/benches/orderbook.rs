use criterion::{Criterion, criterion_group, criterion_main};
use qc_core::{BookDelta, InstrumentId, Price, Qty, Side, Timestamp};
use qc_orderbook::OrderBook;

fn apply_deltas(c: &mut Criterion) {
    let deltas: Vec<BookDelta> = (1..=1_000_u64)
        .map(|seq| BookDelta {
            instrument: InstrumentId(1),
            side: if seq % 2 == 0 { Side::Buy } else { Side::Sell },
            price: Price::from_raw(i64::try_from(seq % 50).unwrap()),
            qty: Qty::from_raw(i64::try_from(seq % 7).unwrap()),
            seq,
            ts_exchange: Timestamp(seq),
            ts_local: Timestamp(seq),
        })
        .collect();
    c.bench_function("orderbook_apply_1000", |b| {
        b.iter(|| {
            let mut book = OrderBook::new(InstrumentId(1));
            for d in &deltas {
                book.apply(d).unwrap();
            }
            std::hint::black_box(book.best_bid())
        });
    });
}

criterion_group!(benches, apply_deltas);
criterion_main!(benches);
