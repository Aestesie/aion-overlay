//! Lokthar's engine: captures the game's traffic, runs A2Tools DPS Meter's
//! parser on it, and tracks the pet collection and the rest the overlay shows.
//! Two ways to run it:
//!
//!   lokthar-engine [--data collection.json] [--paused] [--replay X.pcap [--speed 4]]
//!       the app's helper: JSON lines on stdin and stdout (sidecar.rs)
//!   lokthar-engine replay <file> [--every <s>] [--mode <target mode>]
//!       a recording through the meter and the tracker as fast as it reads,
//!       timed by capture time: the tracker's events and a `dps` line every
//!       `--every` seconds of the recording (and at its end) on stdout, the
//!       final meter as a table on stderr. Nothing is saved.
//!
//! Logs go to stderr.

mod capture;
mod focus;
#[allow(dead_code)] // copied whole from upstream; export_fight_json unused
mod history;
mod meter;
mod replay;
mod sidecar;
mod tracker;

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use a2tools_dps_meter_lib::capture::frame_tap;
use a2tools_dps_meter_lib::clock;
use parking_lot::Mutex;
use serde_json::{Value, json};

use meter::Meter;

fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("replay") => replay(&args[1..]),
        Some("--version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => sidecar::Options::parse(&args).and_then(sidecar::run),
    };
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

/// One JSON line on stdout.
pub fn emit(event: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{event}");
    let _ = out.flush();
}

/// `{"type": kind, ...fields}`.
pub fn event(kind: &str, fields: Value) -> Value {
    let mut ev = json!({ "type": kind });
    if let (Some(ev), Value::Object(fields)) = (ev.as_object_mut(), fields) {
        ev.extend(fields);
    }
    ev
}

fn replay(args: &[String]) -> Result<(), String> {
    let mut path = None;
    let mut every_ms: Option<i64> = None;
    let mut mode = None;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--every" => {
                let s: f64 = rest.next().and_then(|v| v.parse().ok()).ok_or("--every needs seconds")?;
                every_ms = Some((s * 1000.0) as i64);
            }
            "--mode" => mode = Some(rest.next().ok_or("--mode needs a target mode")?.clone()),
            _ if path.is_none() => path = Some(PathBuf::from(arg)),
            _ => return Err(format!("unexpected argument {arg:?}")),
        }
    }
    let path = path.ok_or("replay needs a file: a .pcap, .pcapng or A2Tools packet log")?;

    let payloads = capture::recording::read(&path)?;
    tracing::info!("{}: {} TCP payloads", path.display(), payloads.len());

    let meter = Arc::new(Meter::new());
    if let Some(mode) = &mode {
        if !meter.set_target_mode(mode) {
            return Err(format!("unknown target mode {mode:?}; one of {}", meter::TARGET_MODES.join(", ")));
        }
    }
    // The tracker reads the same frames, from an empty collection.
    let tracker = Arc::new(Mutex::new(tracker::Tracker::new(
        tracker::store::Store::default(),
        None,
        meter.npcs.clone(),
        meter.storage.clone(),
        Box::new(|ev| emit(&ev)),
    )));
    frame_tap::set(Some(Arc::new(move |frame: &[u8]| tracker.lock().frame(clock::now_ms(), frame))));
    let last = replay::run(&meter, payloads, every_ms, |mut dps, at| {
        dps["at"] = json!(at);
        emit(&event("dps", dps));
    })?;
    emit(&event("dps", last.clone()));
    eprint!("{}", table(&last));
    Ok(())
}

/// The meter as a table, for a person reading a replay's result.
fn table(dps: &Value) -> String {
    let mut out = format!(
        "\nTarget: {} (mode {}, {:.1} s)\n",
        dps["targetName"].as_str().filter(|s| !s.is_empty()).unwrap_or("-"),
        dps["targetMode"].as_str().unwrap_or("-"),
        dps["battleTime"].as_i64().unwrap_or_default() as f64 / 1000.0,
    );
    let mut rows: Vec<&Value> = dps["map"].as_object().map(|m| m.values().collect()).unwrap_or_default();
    rows.sort_by(|a, b| b["amount"].as_f64().partial_cmp(&a["amount"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    out += &format!("{:<20} {:<12} {:>12} {:>14} {:>7}\n", "Name", "Class", "DPS", "Damage", "%");
    for row in rows {
        out += &format!(
            "{:<20} {:<12} {:>12.0} {:>14.0} {:>6.1}%\n",
            row["nickname"].as_str().unwrap_or_default(),
            row["job"].as_str().unwrap_or_default(),
            row["dps"].as_f64().unwrap_or_default(),
            row["amount"].as_f64().unwrap_or_default(),
            row["damageContribution"].as_f64().unwrap_or_default(),
        );
    }
    out
}
