//! Rule 7: replaying the committed sample day twice gives the same order log.

use qc_gateway::record;
use qc_risk::Limits;

const DAY: &str = include_str!("../../../../tests/replay/sample_day.csv");
const LIMITS: &str = include_str!("../../../../config/limits/default.toml");

#[test]
fn sample_day_replays_identically_and_exercises_the_engine() {
    let records = record::parse(DAY).unwrap();
    let limits: Limits = toml::from_str(LIMITS).unwrap();
    let first = qc_replay::replay(&records, limits.clone());
    let second = qc_replay::replay(&records, limits);
    assert_eq!(first, second, "replay is not deterministic");

    let count = |word: &str| {
        first
            .lines()
            .filter(|l| l.split(' ').nth(1) == Some(word))
            .count()
    };
    assert!(count("submit") > 100, "the strategy should trade");
    assert!(first.contains("Filled"), "some quotes should fill");
    assert!(
        first.contains("SequenceGap"),
        "the recorded gap should be detected"
    );
    assert_eq!(
        count("halt"),
        0,
        "the sample day must not halt:\n{}",
        first
            .lines()
            .filter(|l| l.contains("halt") || l.contains("reconcile"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    assert_eq!(count("oms"), 0, "no illegal order events");
}
