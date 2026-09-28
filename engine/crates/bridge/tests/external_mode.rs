//! Protocol v1.1, `--venue external` (issues #34, #29): an accepted intent
//! is never routed to `SimVenue`; the TS gateway acts on the signed
//! `approval` instead and reports back what really happened through
//! `report_execution`. A report the OMS cannot legally apply halts the
//! engine rather than being silently accepted.

mod support;

use base64::Engine as _;
use qc_bridge::approval::{self, OrderFields};
use qc_bridge::handle_line;
use serde_json::Value;

fn call(engine: &mut qc_bridge::BridgeEngine, line: &str) -> Value {
    let (response, _) = handle_line(engine, line);
    serde_json::from_str(&response).unwrap()
}

#[test]
fn hello_reports_v1_1_external_mode_and_a_usable_public_key() {
    let mut engine = support::engine_external(&support::small_book_csv(), 1);
    let resp = call(&mut engine, r#"{"v":1,"id":"1","op":"hello"}"#);
    assert_eq!(resp["ok"], true);
    assert_eq!(resp["hello"]["protocol"], "1.1");
    assert_eq!(resp["hello"]["venue_mode"], "external");
    let key_b64 = resp["hello"]["approval_public_key"].as_str().unwrap();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(key_b64)
        .expect("a valid base64 string");
    assert_eq!(decoded.len(), 32, "raw Ed25519 public key is 32 bytes");
}

#[test]
fn sim_mode_hello_reports_sim_and_never_routes_the_op_elsewhere() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    let resp = call(&mut engine, r#"{"v":1,"id":"1","op":"hello"}"#);
    assert_eq!(resp["hello"]["venue_mode"], "sim");
}

#[test]
fn external_mode_never_routes_to_simvenue_and_carries_a_verifiable_approval() {
    let mut engine = support::engine_external(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some(), "book is synced");

    let hello = call(&mut engine, r#"{"v":1,"id":"1","op":"hello"}"#);
    let public_key_b64 = hello["hello"]["approval_public_key"].as_str().unwrap();

    let submit = r#"{"v":1,"id":"2","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    let resp = call(&mut engine, submit);
    assert_eq!(resp["ok"], true);
    let result = &resp["result"];
    assert_eq!(result["accepted"], true);
    assert_eq!(result["client_order_id"], 1);
    let approval = result["approval"].clone();
    assert!(approval.is_object(), "external mode must carry an approval");

    // Never routed: the order sits exactly at PendingNew, not "new" (which
    // is what SimVenue's immediate ack would have produced in `sim` mode —
    // see `protocol_roundtrip.rs`/`kill_switch.rs` for that contrast).
    let status = engine.status();
    let open = status["open_orders"].as_array().unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0]["state"], "pending_new");
    assert_eq!(
        status["position"], "0.00000000",
        "no fill event was ever applied"
    );

    // The TS gateway's own check: signature verifies, fields match, not expired.
    let public_key_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(public_key_b64)
        .unwrap()
        .try_into()
        .unwrap();
    let public_key = ed25519_dalek::VerifyingKey::from_bytes(&public_key_bytes).unwrap();
    let order = OrderFields {
        client_order_id: 1,
        request_id: "dr-1",
        instrument: "1",
        side: "buy",
        qty: "0.001".parse().unwrap(),
        limit_price: "99.8".parse().unwrap(),
        time_in_force: "gtc",
    };
    approval::verify(&public_key, &approval, &order, 0).expect("approval verifies right away");
}

#[test]
fn report_execution_applies_legal_transitions_through_to_a_fill() {
    let mut engine = support::engine_external(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());

    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    let submit_resp = call(&mut engine, submit);
    assert_eq!(submit_resp["result"]["client_order_id"], 1);

    let accepted = call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"report_execution","execution":
            {"client_order_id":1,"event":"accepted","venue_order_id":"555","ts_ns":10}}"#,
    );
    assert_eq!(accepted["ok"], true);
    assert_eq!(engine.status()["open_orders"][0]["state"], "new");

    let filled = call(
        &mut engine,
        r#"{"v":1,"id":"3","op":"report_execution","execution":
            {"client_order_id":1,"event":"filled","qty":"0.001","price":"99.8","ts_ns":20}}"#,
    );
    assert_eq!(filled["ok"], true);
    let status = engine.status();
    assert_eq!(
        status["open_orders"],
        serde_json::json!([]),
        "a filled order is terminal, no longer open"
    );
    assert_eq!(status["position"], "0.00100000");
}

#[test]
fn report_execution_illegal_transition_halts_the_engine() {
    let mut engine = support::engine_external(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());

    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    call(&mut engine, submit);
    call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"report_execution","execution":
            {"client_order_id":1,"event":"accepted","venue_order_id":"555","ts_ns":10}}"#,
    );

    // New -> Rejected is not a legal OMS transition once the venue already
    // accepted the order.
    let illegal = call(
        &mut engine,
        r#"{"v":1,"id":"3","op":"report_execution","execution":
            {"client_order_id":1,"event":"rejected","ts_ns":20}}"#,
    );
    assert_eq!(illegal["ok"], false);
    assert_eq!(illegal["error"]["code"], "illegal_transition");
    assert_eq!(
        engine.status()["halted"],
        "kill_switch",
        "a reconciliation failure must halt, not just log"
    );

    // The halt is enforced on the next order too, not just observed in status.
    let after = call(&mut engine, submit);
    assert_eq!(after["result"]["accepted"], false);
    assert_eq!(after["result"]["halted"], "kill_switch");
}

#[test]
fn report_execution_in_sim_mode_is_a_protocol_error_with_no_state_change() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    let before = engine.status();
    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"1","op":"report_execution","execution":
            {"client_order_id":1,"event":"accepted","venue_order_id":"1","ts_ns":10}}"#,
    );
    assert_eq!(resp["ok"], false);
    assert_eq!(resp["error"]["code"], "invalid_mode");
    assert_eq!(
        engine.status(),
        before,
        "sim mode must reject, not apply, the report"
    );
}
