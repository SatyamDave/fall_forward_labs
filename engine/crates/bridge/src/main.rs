//! `qc-bridge <recording> [--limits <path>] [--decide-every <n>] [--tick <decimal>]
//!            [--model <path> --model-sha256 <hex>]`
//!
//! Reads protocol v1 requests as JSON Lines on stdin, writes one JSON Lines
//! response per request on stdout, and exits after `shutdown` or end of
//! input. Stdout carries only protocol lines (root rule: money is never a
//! float, and every response is schema-checked in tests); logs go to stderr.

use std::io::{BufRead, Write as _};
use std::process::ExitCode;

use qc_bridge::engine::{BridgeEngine, LoadedModel};
use qc_inference::linear::LinearModel;
use qc_risk::{KillSwitch, Limits};

struct Args {
    recording: String,
    limits: String,
    decide_every: u32,
    tick: String,
    model: Option<String>,
    model_sha256: Option<String>,
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

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args(std::env::args().skip(1)).map_err(|e| {
        format!(
            "{e}\nusage: qc-bridge <recording> [--limits <path>] [--decide-every <n>] \
             [--tick <decimal>] [--model <path> --model-sha256 <hex>]"
        )
    })?;
    let limits: Limits = toml::from_str(&std::fs::read_to_string(&args.limits)?)?;
    let tick = args.tick.parse().map_err(|e| format!("bad --tick: {e}"))?;
    let records = BridgeEngine::load_recording(&std::fs::read_to_string(&args.recording)?)?;
    let model = load_model(&args)?;
    let mut engine = BridgeEngine::new(
        records,
        limits,
        KillSwitch::new(),
        tick,
        args.decide_every,
        model,
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
