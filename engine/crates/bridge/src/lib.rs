//! `qc-bridge`: a JSON Lines stdio bridge between the deterministic Rust
//! engine and an external decision agent (protocol v1, `schemas/decision/v1`).
//! Stdout carries only protocol response lines; everything else (parse
//! errors, model load failures) goes to stderr, so a caller reading stdout
//! never has to distinguish a log line from a response.

pub mod engine;
pub mod wire;

pub use engine::{BridgeEngine, LoadedModel};
pub use wire::handle_line;
