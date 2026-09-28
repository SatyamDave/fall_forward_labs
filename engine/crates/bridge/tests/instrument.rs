//! Protocol v1.2, issue #66: `--instrument` teaches the engine a real ticker,
//! tick size, whole-share lots and trading hours, in place of the v1
//! hard-coded instrument `"1"`. Timestamps here are real UTC epoch
//! nanoseconds (unlike most fixtures' small synthetic counters), because
//! trading-hours gating reads a real calendar date out of them.

mod support;

use qc_bridge::handle_line;
use qc_core::{OrderType, Side};
use serde_json::Value;

// 2026-07-15 is a Wednesday; DST is in effect (EDT, UTC-4).
const IN_HOURS_NS: u64 = 1_784_126_100_000_000_000; // 14:35 UTC = 10:35 EDT
const AFTER_CLOSE_NS: u64 = 1_784_149_200_000_000_000; // 21:00 UTC = 17:00 EDT, after the 16:00 close

fn spy_csv() -> String {
    format!(
        "S,2,10,{IN_HOURS_NS},{IN_HOURS_NS},100.00@1;99.99@1,100.02@1;100.03@1\n\
         D,2,11,B,99.98,1,{AFTER_CLOSE_NS},{AFTER_CLOSE_NS}\n"
    )
}

fn call(engine: &mut qc_bridge::BridgeEngine, line: &str) -> Value {
    let (response, _) = handle_line(engine, line);
    serde_json::from_str(&response).unwrap()
}

#[test]
fn decision_request_carries_the_configured_symbol() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    let dr = engine.next_decision_request().expect("book is synced");
    assert_eq!(dr["instrument"], "SPY");
}

#[test]
fn allowed_actions_excludes_buy_sell_outside_trading_hours() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    let first = engine.next_decision_request().expect("in hours");
    assert_eq!(
        first["allowed_actions"],
        serde_json::json!(["buy", "sell", "no_trade"])
    );
    let second = engine.next_decision_request().expect("after close");
    assert_eq!(
        second["allowed_actions"],
        serde_json::json!(["no_trade"]),
        "the engine, not the agent, decides what is offerable outside hours"
    );
}

#[test]
fn submit_is_accepted_in_hours_and_rejected_outside_hours() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    assert!(engine.next_decision_request().is_some(), "in hours");

    let ok = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "1".parse().unwrap(),
        "100.00".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(ok["accepted"], true, "{ok:#}");

    assert!(
        engine.next_decision_request().is_some(),
        "advances past close"
    );
    let rejected = engine.submit_order_intent(
        "dr-2",
        Side::Buy,
        "1".parse().unwrap(),
        "100.00".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(rejected["accepted"], false);
    assert_eq!(rejected["risk_reject"], "outside_trading_hours");
}

#[test]
fn submit_is_rejected_for_a_qty_that_is_not_a_whole_share() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let resp = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "0.5".parse().unwrap(),
        "100.00".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(resp["accepted"], false);
    assert_eq!(resp["risk_reject"], "invalid_qty_step");
}

#[test]
fn submit_is_rejected_for_a_price_finer_than_a_cent() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let resp = engine.submit_order_intent(
        "dr-1",
        Side::Buy,
        "1".parse().unwrap(),
        "100.001".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(resp["accepted"], false);
    assert_eq!(resp["risk_reject"], "invalid_tick_size");
}

#[test]
fn wire_level_intent_must_match_the_configured_symbol() {
    let mut engine = support::engine_with_instrument(&spy_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let wrong_symbol = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"1",
         "limit_price":"100.00","time_in_force":"gtc","reason":"test"}}"#;
    let resp = call(&mut engine, wrong_symbol);
    assert_eq!(resp["ok"], false);
    assert_eq!(resp["error"]["code"], "invalid_fields");

    let right_symbol = r#"{"v":1,"id":"2","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"SPY","side":"buy","qty":"1",
         "limit_price":"100.00","time_in_force":"gtc","reason":"test"}}"#;
    let resp = call(&mut engine, right_symbol);
    assert_eq!(resp["ok"], true);
    assert_eq!(resp["result"]["accepted"], true, "{resp:#}");
}
