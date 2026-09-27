//! Order lifecycle. Matches on [`OrderState`] must list every variant: no `_` arms.

/// Where an order is in its life, as the engine currently believes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderState {
    /// Sent to the venue, no acknowledgement yet.
    PendingNew,
    /// Resting on the venue's book.
    New,
    PartiallyFilled,
    Filled,
    /// Cancel sent, no acknowledgement yet.
    PendingCancel,
    Canceled,
    Rejected,
}

impl OrderState {
    /// A terminal order can never change again.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        match self {
            Self::Filled | Self::Canceled | Self::Rejected => true,
            Self::PendingNew | Self::New | Self::PartiallyFilled | Self::PendingCancel => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::OrderState::*;

    #[test]
    fn only_filled_canceled_rejected_are_terminal() {
        let terminal: Vec<_> = [
            PendingNew,
            New,
            PartiallyFilled,
            Filled,
            PendingCancel,
            Canceled,
            Rejected,
        ]
        .into_iter()
        .filter(|s| s.is_terminal())
        .collect();
        assert_eq!(terminal, [Filled, Canceled, Rejected]);
    }
}
