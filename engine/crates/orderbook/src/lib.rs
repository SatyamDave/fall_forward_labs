//! L2 order book for one instrument, built from [`BookDelta`]s.

use std::collections::BTreeMap;

use qc_core::{BookDelta, InstrumentId, Price, Qty, Side};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BookError {
    WrongInstrument {
        expected: InstrumentId,
        got: InstrumentId,
    },
    /// A sequence number was skipped or repeated; the book must resync from a snapshot.
    SequenceGap { expected: u64, got: u64 },
}

#[derive(Debug)]
pub struct OrderBook {
    instrument: InstrumentId,
    // ponytail: BTreeMap allocates per level; the engine-core pass replaces it with a preallocated ladder.
    bids: BTreeMap<Price, Qty>,
    asks: BTreeMap<Price, Qty>,
    last_seq: Option<u64>,
}

impl OrderBook {
    #[must_use]
    pub fn new(instrument: InstrumentId) -> Self {
        Self {
            instrument,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            last_seq: None,
        }
    }

    /// Applies one delta. On error the book is unchanged.
    ///
    /// # Errors
    /// Returns [`BookError`] for a delta from another instrument or out of sequence.
    pub fn apply(&mut self, delta: &BookDelta) -> Result<(), BookError> {
        if delta.instrument != self.instrument {
            return Err(BookError::WrongInstrument {
                expected: self.instrument,
                got: delta.instrument,
            });
        }
        if let Some(last) = self.last_seq
            && delta.seq != last + 1
        {
            return Err(BookError::SequenceGap {
                expected: last + 1,
                got: delta.seq,
            });
        }
        let levels = match delta.side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        };
        if delta.qty == Qty::ZERO {
            levels.remove(&delta.price);
        } else {
            levels.insert(delta.price, delta.qty);
        }
        self.last_seq = Some(delta.seq);
        Ok(())
    }

    #[must_use]
    pub fn best_bid(&self) -> Option<(Price, Qty)> {
        self.bids.last_key_value().map(|(p, q)| (*p, *q))
    }

    #[must_use]
    pub fn best_ask(&self) -> Option<(Price, Qty)> {
        self.asks.first_key_value().map(|(p, q)| (*p, *q))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use qc_core::Timestamp;

    fn delta(seq: u64, side: Side, price: i64, qty: i64) -> BookDelta {
        BookDelta {
            instrument: InstrumentId(1),
            side,
            price: Price::from_raw(price),
            qty: Qty::from_raw(qty),
            seq,
            ts_exchange: Timestamp(seq),
            ts_local: Timestamp(seq),
        }
    }

    #[test]
    fn tracks_top_of_book_and_rejects_sequence_gaps() {
        let mut book = OrderBook::new(InstrumentId(1));
        book.apply(&delta(1, Side::Buy, 100, 5)).unwrap();
        book.apply(&delta(2, Side::Buy, 101, 3)).unwrap();
        book.apply(&delta(3, Side::Sell, 103, 2)).unwrap();
        book.apply(&delta(4, Side::Buy, 101, 0)).unwrap();
        assert_eq!(
            book.best_bid(),
            Some((Price::from_raw(100), Qty::from_raw(5)))
        );
        assert_eq!(
            book.best_ask(),
            Some((Price::from_raw(103), Qty::from_raw(2)))
        );
        assert_eq!(
            book.apply(&delta(6, Side::Sell, 104, 1)),
            Err(BookError::SequenceGap {
                expected: 5,
                got: 6
            })
        );
    }
}
