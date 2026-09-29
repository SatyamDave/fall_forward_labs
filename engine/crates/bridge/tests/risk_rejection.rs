//! An intent that fails a risk check must never reach the OMS or the venue:
//! no open order, no position change, no client order id.

mod support;

use qc_core::{OrderType, Side};

#[test]
fn oversized_notional_is_rejected_and_never_routed() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some(), "book is synced");

    // 1000 units at ~99.8 is far past both max_notional (25) and max_position (0.01).
    let result = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "1000".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(result["accepted"], false);
    assert_eq!(result["risk_reject"], "max_notional");
    assert!(result.get("client_order_id").is_none());

    let status = engine.status();
    assert_eq!(status["position"], "0.00000000");
    assert_eq!(status["open_orders"], serde_json::json!([]));
}

#[test]
fn oversized_position_is_rejected_when_notional_alone_would_pass() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());

    // 0.02 units at ~99.8 (~$2) keeps notional under max_notional (25),
    // but the size still blows through max_position (0.01).
    let result = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "0.02".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(result["accepted"], false);
    assert_eq!(result["risk_reject"], "max_position");
    assert_eq!(engine.status()["position"], "0.00000000");
}

#[test]
fn a_valid_intent_after_a_rejected_one_is_still_accepted() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());

    let rejected = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "1000".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(rejected["accepted"], false);

    let accepted = engine.submit_order_intent(
        "dr-2",
        Side::Buy,
        "0.001".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(accepted["accepted"], true);
    assert_eq!(engine.status()["open_orders"].as_array().unwrap().len(), 1);
}

/// Protocol v1.3: the request reports risk's own daily notional headroom, and an accepted
/// order is charged at acceptance even while it rests unfilled.
#[test]
fn remaining_daily_notional_drops_when_an_order_is_accepted_unfilled() {
    let csv = format!("{}D,1,12,B,99.7,1,3000,3000\n", support::small_book_csv());
    let mut engine = support::engine_from(&csv, 1);
    let first = engine.next_decision_request().expect("book is synced");
    // config/limits/default.toml: max_daily_notional 50.
    assert_eq!(first["limits"]["remaining_daily_notional"], "50.00000000");

    // A buy at 99.8 rests below the 100.2 ask: accepted, not filled.
    let accepted = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "0.001".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(accepted["accepted"], true);
    assert_eq!(engine.status()["position"], "0.00000000");

    let second = engine.next_decision_request().expect("one more record");
    assert_eq!(second["limits"]["remaining_daily_notional"], "49.90020000");
}
