//! Lokthar's engine: captures the game's traffic and runs A2Tools DPS Meter's
//! parser on it. Two ways to run it:
//!
//!   lokthar-engine                       the app's sidecar (below)
//!   lokthar-engine replay <file> [--every <s>] [--mode <target mode>]
//!
//! As the sidecar it speaks JSON lines, like the Python tracker. Out, on stdout:
//!
//!   {"type": "ready", "version": "0.1.0"}
//!   {"type": "status", "state": "listening" | "locked" | "error", "port"?: 13328, "detail"?: "..."}
//!   {"type": "dps", ...DpsData}       when it changes (checked 5 times a second), else every 5 s
//!   {"type": "details", "target": 123, ...TargetDetailsResponse}   answer to "details"
//!   {"type": "error", "detail": "..."}
//!
//! In, on stdin:
//!
//!   {"cmd": "dpsReset"}                             start over: no target, no damage
//!   {"cmd": "targetMode", "mode": "bossTargets"}    see meter::TARGET_MODES
//!   {"cmd": "details", "target": 123, "actors"?: [1, 2]}
//!   {"cmd": "quit"}
//!
//! Logs go to stderr. Replay reads a recording (capture::recording) as fast as
//! it can, timed by capture time, and prints the meter: a `dps` line every
//! `--every` seconds of the recording (and at its end) on stdout, and a table
//! of the final one on stderr.

mod capture;
mod meter;
mod replay;

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use a2tools_dps_meter_lib::capture::captured_payload::CapturedPayload;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use capture::pcap_capturer::PcapCapturer;
use meter::Meter;

const DPS_EVERY: Duration = Duration::from_millis(200);
const DPS_RESEND: Duration = Duration::from_secs(5);

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
        None => sidecar(),
        Some("replay") => replay(&args[1..]),
        Some("--version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some(other) => Err(format!("unknown command {other:?}; run with no arguments, or `replay <file>`")),
    };
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

/// One JSON line on stdout.
fn emit(event: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{event}");
    let _ = out.flush();
}

/// `{"type": kind, ...fields}`.
fn event(kind: &str, fields: Value) -> Value {
    let mut ev = json!({ "type": kind });
    if let (Some(ev), Value::Object(fields)) = (ev.as_object_mut(), fields) {
        ev.extend(fields);
    }
    ev
}

fn sidecar() -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let meter = Arc::new(Meter::new());
    emit(&event("ready", json!({ "version": env!("CARGO_PKG_VERSION") })));

    let (tx, rx) = mpsc::channel::<CapturedPayload>(4096);
    let capturer = PcapCapturer::new(tx, meter.port_detector.clone());
    capturer.start();
    if capturer.is_running() {
        emit(&event("status", json!({ "state": "listening" })));
    } else {
        emit(&event("status", json!({ "state": "error", "detail": "packet capture did not start (see the log)" })));
    }

    let dispatcher = meter.dispatcher();
    runtime.spawn(async move { dispatcher.run(rx).await });

    // The meter, when it changes, and the lock, when it does.
    let publisher = meter.clone();
    runtime.spawn(async move {
        let mut tick = tokio::time::interval(DPS_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last: Option<(Value, Instant)> = None;
        let mut port = None;
        loop {
            tick.tick().await;
            let now_port = publisher.port_detector.current_port();
            if now_port != port {
                port = now_port;
                emit(&match port {
                    Some(port) => event("status", json!({ "state": "locked", "port": port })),
                    None => event("status", json!({ "state": "listening" })),
                });
            }
            let meter = publisher.clone();
            let Ok(dps) = tokio::task::spawn_blocking(move || meter.dps()).await else { continue };
            if last.as_ref().is_none_or(|(prev, at)| *prev != dps || at.elapsed() >= DPS_RESEND) {
                emit(&event("dps", dps.clone()));
                last = Some((dps, Instant::now()));
            }
        }
    });

    // Commands, until stdin closes (the app quit) or says quit.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(msg) => {
                if !command(&meter, &msg) {
                    break;
                }
            }
            Err(e) => emit(&event("error", json!({ "detail": format!("bad command: {e}") }))),
        }
    }
    capturer.stop();
    Ok(())
}

/// Carry out one command; false to quit.
fn command(meter: &Meter, msg: &Value) -> bool {
    match msg["cmd"].as_str().unwrap_or_default() {
        "quit" => return false,
        "dpsReset" => meter.reset(),
        "targetMode" => {
            let mode = msg["mode"].as_str().unwrap_or_default();
            if !meter.set_target_mode(mode) {
                emit(&event("error", json!({ "detail": format!("unknown target mode {mode:?}") })));
            }
        }
        "details" => {
            let target = msg["target"].as_i64().unwrap_or_default() as i32;
            let actors: Option<Vec<i32>> =
                msg["actors"].as_array().map(|a| a.iter().filter_map(|v| v.as_i64()).map(|v| v as i32).collect());
            let mut details = meter.details(target, actors.as_deref());
            details["target"] = json!(target);
            emit(&event("details", details));
        }
        other => emit(&event("error", json!({ "detail": format!("unknown command {other:?}") }))),
    }
    true
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
