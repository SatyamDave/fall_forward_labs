//! The kill switch is checked before every other risk check (root rule 11:
//! every live process honors it). A clone shares the flag, the way an
//! external operator process would engage it.

mod support;

use qc_core::{OrderType, Side};
use qc_risk::KillSwitch;

#[test]
fn engaged_kill_switch_halts_submit_before_risk_or_the_venue() {
    let kill_switch = KillSwitch::new();
    let mut engine =
        support::engine_with_kill_switch(&support::small_book_csv(), 1, kill_switch.clone());
    assert!(engine.next_decision_request().is_some(), "book is synced");

    // A perfectly ordinary order, well inside every limit.
    let ok = engine.submit_order_intent(
        Side::Buy,
        "0.001".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(
        ok["accepted"], true,
        "passes before the kill switch engages"
    );

    kill_switch.engage();
    let halted = engine.submit_order_intent(
        Side::Buy,
        "0.001".parse().unwrap(),
        "99.8".parse().unwrap(),
        OrderType::Limit,
    );
    assert_eq!(halted["accepted"], false);
    assert_eq!(halted["halted"], "kill_switch");
    assert!(halted.get("risk_reject").is_none());

    assert_eq!(engine.status()["halted"], "kill_switch");
    // The engaged order never reached the OMS: still exactly one open order
    // from the first, accepted submit.
    assert_eq!(engine.status()["open_orders"].as_array().unwrap().len(), 1);
}
