//! Shared test fixtures. Not a test binary itself (see `tests/*.rs`'s `mod support;`).
//! Included into every test binary separately, so any one binary using only
//! some of these functions is not dead code.
#![allow(dead_code)]

use qc_bridge::{BridgeEngine, VenueMode};
use qc_risk::{KillSwitch, Limits};

/// The workspace's default limits, same file `qc_risk`'s own tests load.
#[must_use]
pub fn limits() -> Limits {
    toml::from_str(include_str!("../../../../../config/limits/default.toml")).unwrap()
}

/// A tiny synced book (bid 100.0 / ask 100.2, tick 0.1) plus one more delta so
/// a `decide_every: 1` engine is ready after two records. Kept separate from
/// the committed sample day so risk and protocol tests can reason about exact
/// prices without depending on the fixture's contents.
#[must_use]
pub fn small_book_csv() -> String {
    "S,1,10,1000,1000,100.0@1;99.9@1,100.2@1;100.3@1\n\
     D,1,11,B,99.8,1,2000,2000\n"
        .to_owned()
}

/// The committed sample day used by `just replay`, for determinism and
/// schema-breadth tests.
#[must_use]
pub fn sample_day_csv() -> String {
    std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/replay/sample_day.csv"
    ))
    .expect("tests/replay/sample_day.csv is committed at the repo root")
}

#[must_use]
pub fn engine_from(csv: &str, decide_every: u32) -> BridgeEngine {
    let records = BridgeEngine::load_recording(csv).expect("fixture csv parses");
    BridgeEngine::new(
        records,
        limits(),
        KillSwitch::new(),
        "0.1".parse().unwrap(),
        decide_every,
        None,
        VenueMode::Sim,
    )
}

#[must_use]
pub fn engine_with_kill_switch(
    csv: &str,
    decide_every: u32,
    kill_switch: KillSwitch,
) -> BridgeEngine {
    let records = BridgeEngine::load_recording(csv).expect("fixture csv parses");
    BridgeEngine::new(
        records,
        limits(),
        kill_switch,
        "0.1".parse().unwrap(),
        decide_every,
        None,
        VenueMode::Sim,
    )
}

/// Same as [`engine_from`] but started with `--venue external` (protocol
/// v1.1, issues #34/#29): an accepted intent is recorded `PendingNew` and
/// never routed to `SimVenue`, and the result carries a signed `approval`.
#[must_use]
pub fn engine_external(csv: &str, decide_every: u32) -> BridgeEngine {
    let records = BridgeEngine::load_recording(csv).expect("fixture csv parses");
    BridgeEngine::new(
        records,
        limits(),
        KillSwitch::new(),
        "0.1".parse().unwrap(),
        decide_every,
        None,
        VenueMode::External,
    )
}
