//! Protocol v1 wire format: one JSON object per line in, one per line out.
//! Parsing and dispatch live here so [`handle_line`] is the single place that
//! decides what is a protocol error versus a business decision (an
//! `IntentResult`), which is exactly what schema conformance tests check.

use qc_core::{OrderType, Price, Qty, Side};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::engine::BridgeEngine;

const PROTOCOL_VERSION: u64 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum WireSide {
    Buy,
    Sell,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum WireTimeInForce {
    Ioc,
    Gtc,
}

/// `order_intent.schema.json`. `qty` and `limit_price` reuse
/// `qc_core::Price`/`Qty`'s own `Deserialize`, so a malformed decimal string
/// fails here with the same message `qc_core` would give a config file.
#[derive(Debug, Deserialize)]
struct WireOrderIntent {
    #[allow(dead_code)] // carried on the wire for the caller's own correlation, not used by risk
    request_id: String,
    instrument: String,
    side: WireSide,
    qty: Qty,
    limit_price: Price,
    time_in_force: WireTimeInForce,
    #[allow(dead_code)]
    reason: String,
}

#[derive(Debug, Deserialize)]
struct WireNoTrade {
    #[allow(dead_code)]
    request_id: String,
    #[allow(dead_code)]
    reason: String,
}

fn ok_response(id: &str, extra: Map<String, Value>) -> String {
    let mut obj = Map::new();
    obj.insert("v".to_owned(), json!(PROTOCOL_VERSION));
    obj.insert("id".to_owned(), json!(id));
    obj.insert("ok".to_owned(), json!(true));
    for (k, v) in extra {
        obj.insert(k, v);
    }
    Value::Object(obj).to_string()
}

fn error_response(id: &str, code: &str, message: impl Into<String>) -> String {
    json!({
        "v": PROTOCOL_VERSION,
        "id": id,
        "ok": false,
        "error": {"code": code, "message": message.into()},
    })
    .to_string()
}

fn extra(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Map<String, Value> {
    pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

/// Parses one request line, dispatches it against `engine`, and returns the
/// exactly-one response line. The second element is `true` only for
/// `shutdown`, telling the caller's read loop to stop after this line.
#[must_use]
pub fn handle_line(engine: &mut BridgeEngine, line: &str) -> (String, bool) {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return (
                error_response("unknown", "invalid_json", e.to_string()),
                false,
            );
        }
    };
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();
    if value.get("v").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return (
            error_response(&id, "bad_version", "\"v\" must be the integer 1"),
            false,
        );
    }
    let Some(op) = value.get("op").and_then(Value::as_str) else {
        return (
            error_response(&id, "invalid_fields", "\"op\" is required"),
            false,
        );
    };
    match op {
        "next_decision_request" => {
            let dr = engine.next_decision_request().unwrap_or(Value::Null);
            (ok_response(&id, extra([("decision_request", dr)])), false)
        }
        "submit_order_intent" => (submit_order_intent(engine, &id, &value), false),
        "no_trade" => match serde_json::from_value::<WireNoTrade>(value.clone()) {
            Ok(_) => (ok_response(&id, Map::new()), false),
            Err(e) => (error_response(&id, "invalid_fields", e.to_string()), false),
        },
        "status" => (
            ok_response(&id, extra([("status", engine.status())])),
            false,
        ),
        "shutdown" => (ok_response(&id, Map::new()), true),
        other => (
            error_response(&id, "unknown_op", format!("unknown op {other:?}")),
            false,
        ),
    }
}

fn submit_order_intent(engine: &mut BridgeEngine, id: &str, value: &Value) -> String {
    let Some(intent) = value.get("intent") else {
        return error_response(id, "invalid_fields", "\"intent\" is required");
    };
    let intent: WireOrderIntent = match serde_json::from_value(intent.clone()) {
        Ok(i) => i,
        Err(e) => return error_response(id, "invalid_fields", e.to_string()),
    };
    if intent.instrument != crate::engine::INSTRUMENT_LABEL {
        return error_response(
            id,
            "invalid_fields",
            format!("unknown instrument {:?}", intent.instrument),
        );
    }
    let side = match intent.side {
        WireSide::Buy => Side::Buy,
        WireSide::Sell => Side::Sell,
    };
    let tif = match intent.time_in_force {
        WireTimeInForce::Ioc => OrderType::Ioc,
        WireTimeInForce::Gtc => OrderType::Limit,
    };
    let result = engine.submit_order_intent(side, intent.qty, intent.limit_price, tif);
    ok_response(id, extra([("result", result)]))
}
