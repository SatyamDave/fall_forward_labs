//! `--usage-file`: a restarted `qc-bridge` inherits the day's spent budget from earlier runs,
//! a new day starts fresh, and a usage file it cannot parse refuses the start. Runs the real
//! binary, since the seeding happens at process start.

use std::io::{BufRead, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use qc_bridge::usage;
use serde_json::Value;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "qc-bridge-usage-test-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// `tests/support`'s small book: bid 100.0 / ask 100.2, ready after two records.
fn recording(dir: &Path) -> PathBuf {
    let path = dir.join("book.csv");
    std::fs::write(
        &path,
        "S,1,10,1000,1000,100.0@1;99.9@1,100.2@1;100.3@1\nD,1,11,B,99.8,1,2000,2000\n",
    )
    .unwrap();
    path
}

/// One run of the binary: a decision request, then one resting 0.001 @ 99.8 buy
/// (notional 0.0998, never fills). Returns the submit result, or the exit status and
/// stderr if the process refused to start.
fn run_once(dir: &Path, usage_file: &Path) -> Result<Value, String> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_qc-bridge"))
        .arg(recording(dir))
        .args([
            "--limits",
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../config/limits/default.toml"
            ),
        ])
        .args(["--decide-every", "1", "--usage-file"])
        .arg(usage_file)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    // A refused start may close stdin before we write; the exit status tells us why.
    let _ = writeln!(
        stdin,
        r#"{{"v":1,"id":"1","op":"next_decision_request"}}
{{"v":1,"id":"2","op":"submit_order_intent","intent":{{"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001","limit_price":"99.8","time_in_force":"gtc","reason":"t"}}}}
{{"v":1,"id":"3","op":"shutdown"}}"#
    );
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let lines: Vec<Value> = BufReader::new(&out.stdout[..])
        .lines()
        .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
        .collect();
    Ok(lines[1]["result"].clone())
}

/// A prior run's accepted notional on `day`, as the bridge itself writes it.
fn prior(day: u64, notional: &str) -> String {
    format!(r#"{{"day":{day},"run":"1-1","notional":"{notional}"}}"#)
}

#[test]
fn a_restart_on_the_same_day_keeps_the_notional_already_spent() {
    let dir = temp_dir("same-day");
    let usage_file = dir.join("usage.jsonl");
    // The cap is 50. 49.95 already spent today leaves less than this order's 0.0998.
    std::fs::write(&usage_file, prior(usage::today(), "49.95") + "\n").unwrap();
    let result = run_once(&dir, &usage_file).unwrap();
    assert_eq!(result["accepted"], false, "{result}");
    assert_eq!(result["risk_reject"], "max_daily_notional");
}

#[test]
fn a_run_records_its_order_and_the_next_run_counts_it() {
    let dir = temp_dir("chain");
    let usage_file = dir.join("usage.jsonl");
    std::fs::write(&usage_file, prior(usage::today(), "49.85") + "\n").unwrap();
    // 49.85 + 0.0998 fits; the second run's order would reach 50.0496.
    assert_eq!(run_once(&dir, &usage_file).unwrap()["accepted"], true);
    let used = usage::load(&usage_file, usage::today()).unwrap();
    assert_eq!(used.notional, 4_994_980_000, "49.85 + 0.0998 in raw units");
    let second = run_once(&dir, &usage_file).unwrap();
    assert_eq!(second["risk_reject"], "max_daily_notional", "{second}");
}

#[test]
fn a_new_day_starts_with_the_full_budget() {
    let dir = temp_dir("new-day");
    let usage_file = dir.join("usage.jsonl");
    std::fs::write(&usage_file, prior(usage::today() - 1, "50") + "\n").unwrap();
    let result = run_once(&dir, &usage_file).unwrap();
    assert_eq!(result["accepted"], true, "{result}");
}

#[test]
fn a_corrupt_usage_file_refuses_to_start() {
    let dir = temp_dir("corrupt");
    let usage_file = dir.join("usage.jsonl");
    for bad in [
        "not json\n".to_owned(),
        prior(usage::today(), "1") + "\n{\"day\":1,\"run\":\"x\"}\n",
        r#"{"day":1,"run":"x","notional":"1","extra":1}"#.to_owned(),
        prior(usage::today(), "1") + "\n{\"day\":", // a torn last line
    ] {
        std::fs::write(&usage_file, &bad).unwrap();
        let err = run_once(&dir, &usage_file).unwrap_err();
        assert!(err.contains("--usage-file"), "{bad:?}: {err}");
    }
}

#[test]
fn earlier_losses_shrink_the_loss_budget_and_profits_never_grow_it() {
    let limits: qc_risk::Limits =
        toml::from_str(include_str!("../../../../config/limits/default.toml")).unwrap();
    let dir = temp_dir("loss");
    let usage_file = dir.join("usage.jsonl");
    let day = usage::today();
    // Run a lost 3 and then recovered to -2 (its last line wins); run b lost 1.5.
    std::fs::write(
        &usage_file,
        format!(
            "{{\"day\":{day},\"run\":\"a\",\"pnl\":\"-3\"}}\n\
             {{\"day\":{day},\"run\":\"a\",\"pnl\":\"-2\"}}\n\
             {{\"day\":{day},\"run\":\"b\",\"pnl\":\"-1.5\"}}\n"
        ),
    )
    .unwrap();
    let seeded = usage::seed_limits(limits.clone(), &usage::load(&usage_file, day).unwrap());
    assert_eq!(seeded.max_daily_loss.to_string(), "1.50000000", "5 - 3.5");

    std::fs::write(
        &usage_file,
        format!("{{\"day\":{day},\"run\":\"a\",\"pnl\":\"9\"}}\n"),
    )
    .unwrap();
    let seeded = usage::seed_limits(limits.clone(), &usage::load(&usage_file, day).unwrap());
    assert_eq!(seeded.max_daily_loss, limits.max_daily_loss);
    assert_eq!(seeded.max_daily_notional, limits.max_daily_notional);
}

mod support;

fn call(engine: &mut qc_bridge::BridgeEngine, line: &str) -> Value {
    serde_json::from_str(&qc_bridge::handle_line(engine, line).0).unwrap()
}

const SUBMIT: &str = r#"{"v":1,"id":"1","op":"submit_order_intent","intent":
    {"request_id":"dr-1","instrument":"1","side":"buy","qty":"0.001",
     "limit_price":"99.8","time_in_force":"gtc","reason":"test"}}"#;

#[test]
fn an_accepted_intent_counts_notional_and_only_a_reported_fill_counts_pnl() {
    let dir = temp_dir("fill");
    let usage_file = dir.join("usage.jsonl");
    let mut engine = support::engine_external_reconciled(&support::small_book_csv(), 1);
    engine.set_usage_log(usage::UsageLog::new(usage_file.clone()));
    assert!(engine.next_decision_request().is_some());
    assert_eq!(call(&mut engine, SUBMIT)["result"]["accepted"], true);
    call(
        &mut engine,
        r#"{"v":1,"id":"2","op":"report_execution","execution":
            {"client_order_id":1,"event":"accepted","venue_order_id":"555","ts_ns":10}}"#,
    );
    let text = std::fs::read_to_string(&usage_file).unwrap();
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(text.contains(r#""notional":"0.09980000""#), "{text}");

    call(
        &mut engine,
        r#"{"v":1,"id":"3","op":"report_execution","execution":
            {"client_order_id":1,"event":"filled","qty":"0.001","price":"99.8","ts_ns":20}}"#,
    );
    let text = std::fs::read_to_string(&usage_file).unwrap();
    assert_eq!(text.lines().count(), 2, "{text}");
    assert!(text.lines().nth(1).unwrap().contains(r#""pnl":"#), "{text}");
}

#[test]
fn a_spent_loss_budget_halts_before_the_first_decision() {
    let used = usage::Used {
        notional: 0,
        loss: 5 * i128::from(qc_core::SCALE),
    };
    let limits = usage::seed_limits(support::limits(), &used);
    let mut engine = support::engine_from_with_limits(&support::small_book_csv(), 1, limits);
    engine.next_decision_request();
    assert_eq!(engine.status()["halted"], "max_daily_loss");
}

#[test]
fn an_unwritable_usage_file_halts_instead_of_accepting() {
    let dir = temp_dir("unwritable");
    let mut engine = support::engine_external_reconciled(&support::small_book_csv(), 1);
    // A directory cannot be opened for append.
    engine.set_usage_log(usage::UsageLog::new(dir));
    assert!(engine.next_decision_request().is_some());
    let result = &call(&mut engine, SUBMIT)["result"];
    assert_eq!(result["accepted"], false, "{result}");
    assert!(result.get("approval").is_none());
    assert_eq!(engine.status()["halted"], "kill_switch");
}
