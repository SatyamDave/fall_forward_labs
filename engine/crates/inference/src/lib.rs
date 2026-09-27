//! Model inference inside the engine. Models come only from `ml/export` with a
//! matching registry hash. When a model cannot answer, the answer is no signal.

/// A model's view of expected edge, in basis points. Positive favors buying.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Signal {
    pub edge_bps: i32,
}

/// A loaded model. `predict` must be deterministic and within its latency
/// budget; on missing features, a stale model, or any doubt it returns `None`.
pub trait Model {
    fn predict(&self, features: &[f32]) -> Option<Signal>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Returns a signal only for the feature count it was trained on.
    struct Sign {
        n_features: usize,
    }

    impl Model for Sign {
        fn predict(&self, features: &[f32]) -> Option<Signal> {
            if features.len() != self.n_features || features.iter().any(|f| !f.is_finite()) {
                return None;
            }
            let edge_bps = if features[0] > 0.0 { 1 } else { -1 };
            Some(Signal { edge_bps })
        }
    }

    #[test]
    fn bad_input_means_no_signal() {
        let model = Sign { n_features: 2 };
        assert_eq!(model.predict(&[0.5, 1.0]), Some(Signal { edge_bps: 1 }));
        assert_eq!(model.predict(&[0.5]), None);
        assert_eq!(model.predict(&[f32::NAN, 1.0]), None);
    }
}
