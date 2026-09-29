//! `--usage-file` (2026-09-29 restart defect): account-wide daily risk usage that survives a
//! restart. `qc_risk::RiskEngine` keeps its daily-notional counter and this crate keeps daily
//! P&L in memory only, so every restart used to grant a fresh daily budget. This file is an
//! append-only JSON Lines ledger, one line per accepted order and one per applied fill:
//!
//! ```text
//! {"day":20725,"run":"4242-1790690400000000000","notional":"0.09980000"}
//! {"day":20725,"run":"4242-1790690400000000000","pnl":"-0.01000000"}
//! ```
//!
//! At startup [`seed_limits`] reads every line for today and lowers `max_daily_notional` and
//! `max_daily_loss` by what earlier runs already used. It only ever lowers a limit, so the
//! risk crate's own checks do the rejecting unchanged. A file that exists but does not parse
//! refuses the start: an unknown past is not a zero past.
//!
//! `day` is the wall-clock UTC day (`unix_ns / 86_400e9`), the same bucket `qc_risk` uses for
//! `max_daily_notional` (its placeholder for the exchange calendar, pending #23). It is a
//! wall-clock read on purpose: the budget belongs to the real account's real day, not to the
//! replayed market clock. Replay and `just agent-sim` never pass `--usage-file`.

use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use qc_core::Price;
use qc_risk::Limits;
use serde::Deserialize;
use serde_json::json;

const NANOS_PER_DAY: u128 = 24 * 60 * 60 * 1_000_000_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    day: u64,
    run: String,
    notional: Option<Price>,
    pnl: Option<Price>,
}

/// Today's UTC day number from the wall clock.
#[must_use]
pub fn today() -> u64 {
    let ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    u64::try_from(ns / NANOS_PER_DAY).unwrap_or(u64::MAX)
}

/// What earlier runs used on `day`, in raw [`Price`] units.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Used {
    /// Sum of every accepted order's notional.
    pub notional: i128,
    /// Loss as a positive amount: minus the sum of each run's last recorded P&L, floored at 0.
    pub loss: i128,
}

/// Reads `path` (missing means nothing used yet).
///
/// # Errors
/// A read error, or the first line that is not a well-formed usage record.
pub fn load(path: &Path, day: u64) -> Result<Used, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Used::default()),
        Err(e) => return Err(format!("--usage-file {}: {e}", path.display())),
    };
    let mut notional = 0_i128;
    // Last P&L per run, in first-seen order (a Vec, never a HashMap).
    let mut last_pnl: Vec<(String, i128)> = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let bad = |why: String| format!("--usage-file {} line {}: {why}", path.display(), n + 1);
        let line: Line = serde_json::from_str(raw).map_err(|e| bad(e.to_string()))?;
        if line.notional.is_some() == line.pnl.is_some() {
            return Err(bad("needs exactly one of notional, pnl".to_owned()));
        }
        if line.day != day {
            continue;
        }
        if let Some(v) = line.notional {
            if v < Price::ZERO {
                return Err(bad("negative notional".to_owned()));
            }
            notional += i128::from(v.raw());
        }
        if let Some(v) = line.pnl {
            match last_pnl.iter_mut().find(|(r, _)| *r == line.run) {
                Some(entry) => entry.1 = i128::from(v.raw()),
                None => last_pnl.push((line.run, i128::from(v.raw()))),
            }
        }
    }
    let pnl: i128 = last_pnl.iter().map(|(_, v)| v).sum();
    Ok(Used {
        notional,
        loss: (-pnl).max(0),
    })
}

/// `limits` with today's remaining budget: each daily cap less what `used` already spent,
/// floored at zero. Never raises a limit. A zero loss budget halts on the first loss check.
#[must_use]
pub fn seed_limits(mut limits: Limits, used: &Used) -> Limits {
    let less = |cap: Price, spent: i128| {
        let left = (i128::from(cap.raw()) - spent).clamp(0, i128::from(cap.raw()));
        Price::from_raw(i64::try_from(left).unwrap_or(0))
    };
    limits.max_daily_notional = less(limits.max_daily_notional, used.notional);
    limits.max_daily_loss = less(limits.max_daily_loss, used.loss);
    limits
}

/// This process's append handle on the usage file.
#[derive(Debug)]
pub struct UsageLog {
    path: PathBuf,
    run: String,
}

impl UsageLog {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        Self {
            path,
            run: format!("{}-{started}", std::process::id()),
        }
    }

    /// One accepted order's notional.
    ///
    /// # Errors
    /// The file could not be appended to.
    pub fn order(&self, notional: Price) -> std::io::Result<()> {
        self.append("notional", notional)
    }

    /// This run's cumulative daily P&L after a fill.
    ///
    /// # Errors
    /// The file could not be appended to.
    pub fn pnl(&self, pnl: Price) -> std::io::Result<()> {
        self.append("pnl", pnl)
    }

    fn append(&self, key: &str, value: Price) -> std::io::Result<()> {
        let line = json!({"day": today(), "run": self.run, key: value.to_string()});
        // One short write per line with O_APPEND, so concurrent appenders never interleave.
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        f.write_all(format!("{line}\n").as_bytes())?;
        f.sync_data()
    }
}
