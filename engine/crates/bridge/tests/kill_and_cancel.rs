//! Protocol v1.2: the `kill` op (issue #44, in-band trigger) and
//! `cancel_order_intent` (always allowed for our own open orders, risk never
//! blocks a cancel). `tests/chaos.rs` covers the out-of-band `--kill-file`
//! trigger and the 1-second budget.

mod support;

use base64::Engine as _;
use qc_bridge::handle_line;
use serde_json::Value;

fn call(engine: &mut qc_bridge::BridgeEngine, line: &str) -> Value {
    let (response, _) = handle_line(engine, line);
    serde_json::from_str(&response).unwrap()
}

#[test]
fn kill_op_engages_the_switch_and_cancels_every_open_order_in_sim_mode() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    assert_eq!(call(&mut engine, submit)["result"]["accepted"], true);
    assert_eq!(engine.status()["open_orders"].as_array().unwrap().len(), 1);

    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"kill","reason":"operator stop"}"#,
    );
    assert_eq!(resp["ok"], true);
    assert_eq!(engine.status()["halted"], "kill_switch");
    assert_eq!(
        engine.status()["open_orders"].as_array().unwrap().len(),
        0,
        "kill must cancel every open order, not just refuse new ones"
    );

    let after = call(&mut engine, submit);
    assert_eq!(after["result"]["accepted"], false);
    assert_eq!(after["result"]["halted"], "kill_switch");
}

#[test]
fn kill_op_is_idempotent() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    assert_eq!(
        call(&mut engine, r#"{"v":1,"id":"1","op":"kill","reason":"a"}"#)["ok"],
        true
    );
    assert_eq!(
        call(&mut engine, r#"{"v":1,"id":"2","op":"kill","reason":"b"}"#)["ok"],
        true
    );
    assert_eq!(engine.status()["halted"], "kill_switch");
}

#[test]
fn kill_op_in_external_mode_marks_open_orders_pending_cancel() {
    // No real venue to route a cancel to in `external` mode; the OMS still
    // records the cancel request so the gateway sees it via `status` and
    // finishes the cancel for real (see `BridgeEngine::cancel_all_open`).
    let mut engine = support::engine_external_reconciled(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    assert_eq!(call(&mut engine, submit)["result"]["accepted"], true);

    call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"kill","reason":"operator stop"}"#,
    );
    let status = engine.status();
    let open = status["open_orders"].as_array().unwrap();
    assert_eq!(open.len(), 1, "the order stays visible, now pending cancel");
    assert_eq!(open[0]["state"], "pending_cancel");
}

#[test]
fn cancel_order_intent_cancels_a_resting_order_in_sim_mode() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    assert_eq!(call(&mut engine, submit)["result"]["accepted"], true);

    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"cancel_order_intent","client_order_id":1,"reason":"changed my mind"}"#,
    );
    assert_eq!(resp["ok"], true, "{resp:#}");
    assert_eq!(resp["result"]["accepted"], true);
    assert_eq!(resp["result"]["client_order_id"], 1);
    assert_eq!(engine.status()["open_orders"].as_array().unwrap().len(), 0);
}

#[test]
fn cancel_order_intent_in_external_mode_mints_a_cancel_approval() {
    let mut engine = support::engine_external_reconciled(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    assert_eq!(call(&mut engine, submit)["result"]["accepted"], true);

    let hello = call(&mut engine, r#"{"v":1,"id":"2","op":"hello"}"#);
    let public_key_b64 = hello["hello"]["approval_public_key"].as_str().unwrap();

    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"3","op":"cancel_order_intent","client_order_id":1,"reason":"changed my mind"}"#,
    );
    assert_eq!(resp["ok"], true, "{resp:#}");
    let approval = resp["result"]["approval"].clone();
    assert!(
        approval.is_object(),
        "external mode must carry an approval: {resp:#}"
    );

    // Never routed anywhere real: the order sits at PendingCancel.
    let status = engine.status();
    assert_eq!(status["open_orders"][0]["state"], "pending_cancel");

    let public_key_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(public_key_b64)
        .unwrap()
        .try_into()
        .unwrap();
    let public_key = ed25519_dalek::VerifyingKey::from_bytes(&public_key_bytes).unwrap();
    let cancel = qc_bridge::approval::CancelFields { client_order_id: 1 };
    qc_bridge::approval::verify_cancel(&public_key, &approval, &cancel, 0)
        .expect("approval verifies right away");
}

#[test]
fn cancel_order_intent_for_an_unknown_id_is_an_error() {
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"1","op":"cancel_order_intent","client_order_id":999,"reason":"x"}"#,
    );
    assert_eq!(resp["ok"], false);
    assert_eq!(resp["error"]["code"], "invalid_cancel");
}

#[test]
fn cancel_order_intent_does_not_check_the_halted_flag() {
    // Risk never blocks a cancel -- root rule: a halt refuses new entries,
    // it never blocks getting out of a position. `kill`'s own
    // `cancel_all_open` already requested a cancel for every open order, so
    // asking again from `PendingCancel` is illegal on the OMS's own terms
    // (not a fresh state to request a cancel from) -- proving
    // `cancel_order_intent` reached the OMS at all (not silently blocked by
    // `self.halted`) rather than returning "unknown_order_id".
    let mut engine = support::engine_from(&support::small_book_csv(), 1);
    assert!(engine.next_decision_request().is_some());
    let submit = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
        {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
         "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;
    assert_eq!(call(&mut engine, submit)["result"]["accepted"], true);

    call(&mut engine, r#"{"v":1,"id":"2","op":"kill","reason":"x"}"#);
    assert_eq!(
        engine.status()["open_orders"].as_array().unwrap().len(),
        0,
        "sim mode's SimVenue acks the kill's own cancel immediately"
    );
    let resp = call(
        &mut engine,
        r#"{"v":1,"id":"3","op":"cancel_order_intent","client_order_id":1,"reason":"x"}"#,
    );
    assert_eq!(resp["ok"], false, "{resp:#}");
    assert_eq!(resp["error"]["code"], "invalid_cancel");
    assert!(
        resp["error"]["message"]
            .as_str()
            .unwrap()
            .contains("terminal"),
        "already Canceled by the kill itself, not blocked by the halt: {resp:#}"
    );
}
