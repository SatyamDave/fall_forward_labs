//! `qc-bridge <recording> [--limits <path>] [--decide-every <n>] [--tick <decimal>]
//!            [--model <path> --model-sha256 <hex>] [--venue sim|external]
//!            [--kill-file <path>] [--instrument <path.toml>]`
//!
//! Reads protocol v1 requests as JSON Lines on stdin, writes one JSON Lines
//! response per request on stdout, and exits after `shutdown` or end of
//! input. Stdout carries only protocol lines (root rule: money is never a
//! float, and every response is schema-checked in tests); logs go to stderr.

use std::io::{BufRead, Write as _};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use qc_bridge::engine::{BridgeEngine, LoadedModel, VenueMode};
use qc_bridge::instrument::Instrument;
use qc_inference::linear::LinearModel;
use qc_risk::{KillSwitch, Limits};

struct Args {
    recording: String,
    limits: String,
    decide_every: u32,
    tick: String,
    model: Option<String>,
    model_sha256: Option<String>,
    venue: VenueMode,
    kill_file: Option<PathBuf>,
    instrument: Option<String>,
}

const DEFAULT_LIMITS: &str = "../config/limits/default.toml";
const DEFAULT_DECIDE_EVERY: u32 = 50;
const DEFAULT_TICK: &str = "0.1";

fn parse_args(mut rest: impl Iterator<Item = String>) -> Result<Args, String> {
    let recording = rest.next().ok_or("missing <recording>")?;
    let mut args = Args {
        recording,
        limits: DEFAULT_LIMITS.to_owned(),
        decide_every: DEFAULT_DECIDE_EVERY,
        tick: DEFAULT_TICK.to_owned(),
        model: None,
        model_sha256: None,
        venue: VenueMode::Sim,
        kill_file: None,
        instrument: None,
    };
    while let Some(flag) = rest.next() {
        let mut value = || rest.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--limits" => args.limits = value()?,
            "--decide-every" => {
                args.decide_every = value()?
                    .parse()
                    .map_err(|_| "--decide-every must be a positive integer".to_owned())?;
            }
            "--tick" => args.tick = value()?,
            "--model" => args.model = Some(value()?),
            "--model-sha256" => args.model_sha256 = Some(value()?),
            "--venue" => args.venue = value()?.parse()?,
            "--kill-file" => args.kill_file = Some(PathBuf::from(value()?)),
            "--instrument" => args.instrument = Some(value()?),
            other => return Err(format!("unknown flag {other}")),
        }
    }
    Ok(args)
}

fn load_model(args: &Args) -> Result<Option<LoadedModel>, Box<dyn std::error::Error>> {
    let (Some(path), Some(sha256)) = (&args.model, &args.model_sha256) else {
        return Ok(None);
    };
    let bytes = std::fs::read(path)?;
    let model = LinearModel::load(&bytes, sha256)?;
    Ok(Some(LoadedModel {
        model: Box::new(model),
        sha256: sha256.trim().to_owned(),
    }))
}

/// `--instrument <path.toml>` (protocol v1.2, issue #66): its own `limits`
/// field names the per-instrument limits file to load, in place of
/// `--limits` (which keeps its v1 meaning -- the global default -- only when
/// no instrument is configured). Fails closed on a config the bridge cannot
/// fully parse; never falls back to the hard-coded default silently.
fn load_instrument(path: &str) -> Result<Instrument, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string(path)?;
    let dir = Path::new(path).parent().unwrap_or_else(|| Path::new("."));
    Instrument::parse(&text, dir).map_err(Into::into)
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args(std::env::args().skip(1)).map_err(|e| {
        format!(
            "{e}\nusage: qc-bridge <recording> [--limits <path>] [--decide-every <n>] \
             [--tick <decimal>] [--model <path> --model-sha256 <hex>] [--venue sim|external] \
             [--kill-file <path>] [--instrument <path.toml>]"
        )
    })?;
    let instrument = args
        .instrument
        .as_deref()
        .map(load_instrument)
        .transpose()?;
    let limits_path = instrument
        .as_ref()
        .map_or_else(|| PathBuf::from(&args.limits), |i| i.limits_path.clone());
    let limits: Limits = toml::from_str(&std::fs::read_to_string(&limits_path)?)?;
    let tick = args.tick.parse().map_err(|e| format!("bad --tick: {e}"))?;
    let records = BridgeEngine::load_recording(&std::fs::read_to_string(&args.recording)?)?;
    let model = load_model(&args)?;
    let mut engine = BridgeEngine::with_instrument(
        records,
        limits,
        KillSwitch::new(),
        tick,
        args.decide_every,
        model,
        args.venue,
        args.kill_file,
        instrument,
    );

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let (response, shutdown) = qc_bridge::handle_line(&mut engine, &line);
        writeln!(out, "{response}")?;
        out.flush()?;
        if shutdown {
            break;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("qc-bridge: {e}");
            ExitCode::FAILURE
        }
    }
}
