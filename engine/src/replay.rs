//! A recording through the meter, as fast as it reads, timed by capture time.

use std::sync::Arc;

use a2tools_dps_meter_lib::capture::captured_payload::CapturedPayload;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::meter::Meter;

/// Feed `payloads` through `meter` and return the meter at the end. With
/// `every_ms`, `tick` gets the meter (and the capture time) each time that
/// much of the recording has gone by.
pub fn run(
    meter: &Arc<Meter>,
    payloads: Vec<CapturedPayload>,
    every_ms: Option<i64>,
    mut tick: impl FnMut(Value, i64),
) -> Result<Value, String> {
    let mut dispatcher = meter.dispatcher();
    dispatcher.set_replay(true);
    // One thread: the dispatcher pins the parser's clock (thread-local) to
    // each packet's capture time, and the meter is read on the same thread.
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
    Ok(runtime.block_on(async {
        let (tx, rx) = mpsc::channel::<CapturedPayload>(1);
        let dispatching = tokio::spawn(async move { dispatcher.run(rx).await });
        let mut next_at: Option<i64> = None;
        for payload in payloads {
            let at = payload.captured_at_ms;
            if tx.send(payload).await.is_err() {
                break;
            }
            if let Some(every) = every_ms {
                let due = *next_at.get_or_insert(at + every);
                if at >= due {
                    next_at = Some(due + every);
                    tick(meter.dps(), at);
                }
            }
        }
        drop(tx);
        let _ = dispatching.await;
        meter.dps()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// `<length varint><body>`, by the game's rule: the value is the body's
    /// length plus 4.
    fn frame(body: &[u8]) -> Vec<u8> {
        let mut v = body.len() as u32 + 4;
        let mut out = Vec::new();
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out.extend_from_slice(body);
        out
    }

    fn segment(data: Vec<u8>, at: i64) -> CapturedPayload {
        CapturedPayload {
            src_port: 13328,
            dst_port: 50349,
            data,
            device_name: Some("Ethernet".into()),
            captured_at_ms: at,
            src_ip: Some([10, 0, 0, 1].into()),
            dst_ip: Some([192, 168, 1, 2].into()),
            tcp_seq: 0,
            tcp_ack: 0,
        }
    }

    /// A stream the meter locks onto (a frame carrying the game's record
    /// terminator, 20 times a second) with a damage record each second: a
    /// 976 hit by actor 1395 on target 30001, from a live capture (upstream's
    /// `additional_hits_are_read_from_the_record_tail`).
    #[test]
    fn a_recorded_fight_comes_out_as_meter_rows() {
        let start = 1_792_350_000_000;
        let filler = frame(&[0x36, 0x0E, 0x00, 0x36]);
        let hit = frame(&[&[0x04, 0x38][..], &hex("b1ea011600f30a40c0f40063028000010b199b5f01000000ac52d007")].concat());
        let mut payloads = Vec::new();
        for i in 0..400 {
            let mut data = filler.clone();
            // Hits from 5 s in, once the lock is in (its grace for a
            // physical device is 2.5 s), for 10 s.
            if i >= 100 && i < 300 && i % 20 == 0 {
                data.extend(&hit);
            }
            payloads.push(segment(data, start + i * 50));
        }
        let meter = Arc::new(Meter::new());
        assert!(meter.set_target_mode("allTargets"));
        let mut ticks = 0;
        let dps = run(&meter, payloads, Some(1_000), |_, _| ticks += 1).unwrap();
        assert_eq!(meter.port_detector.current_port(), Some(13328), "locked onto the game's port");
        assert!(ticks >= 18, "a tick each second of the recording: {ticks}");
        let row = &dps["map"]["1395"];
        assert_eq!(row["amount"].as_f64(), Some(976.0 * 10.0), "{dps}");
        assert!(row["dps"].as_f64().unwrap() > 0.0, "{dps}");
    }
}
