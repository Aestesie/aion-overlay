//! Recorded captures, read back as the payloads live capture would have given:
//!
//! - `.pcap` / `.pcapng`, as Wireshark, tcpdump or the Python tracker's
//!   recorder write them: every TCP segment, both directions, all ports.
//! - A2Tools DPS Meter's packet log (Settings > packet logging), one line per
//!   segment: `TIMESTAMP|Client:<client port>:<server port>|HEX`. Only what
//!   came from the game's port after the lock, so the same fight can be read
//!   by both meters and the numbers compared.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use a2tools_dps_meter_lib::capture::captured_payload::CapturedPayload;
use pcap_file::pcap::PcapReader;
use pcap_file::pcapng::{Block, PcapNgReader};

use super::pcap_capturer::parse_tcp_payload;

/// Every TCP payload in the recording, in order, with its capture time.
pub fn read(path: &Path) -> Result<Vec<CapturedPayload>, String> {
    let mut magic = [0u8; 4];
    File::open(path)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    match magic {
        [0x0a, 0x0d, 0x0d, 0x0a] => read_pcapng(path),
        [0xd4, 0xc3, 0xb2, 0xa1] | [0xa1, 0xb2, 0xc3, 0xd4] | [0x4d, 0x3c, 0xb2, 0xa1] | [0xa1, 0xb2, 0x3c, 0x4d] => {
            read_pcap(path)
        }
        _ => read_packet_log(path),
    }
}

fn open(path: &Path) -> Result<BufReader<File>, String> {
    File::open(path).map(BufReader::new).map_err(|e| format!("{}: {e}", path.display()))
}

fn ms(ts: std::time::Duration) -> i64 {
    ts.as_millis() as i64
}

fn read_pcap(path: &Path) -> Result<Vec<CapturedPayload>, String> {
    let mut reader = PcapReader::new(open(path)?).map_err(|e| e.to_string())?;
    let link_type = u32::from(reader.header().datalink) as std::ffi::c_int;
    let mut out = Vec::new();
    while let Some(packet) = reader.next_packet() {
        let packet = packet.map_err(|e| e.to_string())?;
        if let Some(mut payload) = parse_tcp_payload(&packet.data, link_type, "recording") {
            payload.captured_at_ms = ms(packet.timestamp);
            out.push(payload);
        }
    }
    Ok(out)
}

fn read_pcapng(path: &Path) -> Result<Vec<CapturedPayload>, String> {
    let mut reader = PcapNgReader::new(open(path)?).map_err(|e| e.to_string())?;
    // Each interface its own link type and device name, in the order declared.
    let mut interfaces: Vec<(std::ffi::c_int, String)> = Vec::new();
    let mut out = Vec::new();
    while let Some(block) = reader.next_block() {
        match block.map_err(|e| e.to_string())? {
            Block::SectionHeader(_) => interfaces.clear(),
            Block::InterfaceDescription(idb) => {
                let n = interfaces.len();
                interfaces.push((u32::from(idb.linktype) as std::ffi::c_int, format!("recording {n}")));
            }
            Block::EnhancedPacket(epb) => {
                let Some((link_type, device)) = interfaces.get(epb.interface_id as usize) else { continue };
                if let Some(mut payload) = parse_tcp_payload(&epb.data, *link_type, device) {
                    payload.captured_at_ms = ms(epb.timestamp);
                    out.push(payload);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

fn read_packet_log(path: &Path) -> Result<Vec<CapturedPayload>, String> {
    let mut out = Vec::new();
    // Each connection's client port, from its stream name; the oldest logs
    // name only the server port.
    let mut clients: HashMap<String, u16> = HashMap::new();
    for line in open(path)?.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(3, '|');
        let (Some(ts), Some(key), Some(hex)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let Ok(at) = chrono::DateTime::parse_from_rfc3339(ts.trim()) else { continue };
        let mut ports = key.rsplit(':');
        let Some(server) = ports.next().and_then(|p| p.parse::<u16>().ok()) else { continue };
        let n = clients.len() as u16;
        let client = ports
            .next()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or_else(|| *clients.entry(key.to_string()).or_insert(50_000 + n));
        let Some(data) = decode_hex(hex) else { continue };
        out.push(CapturedPayload {
            src_port: server,
            dst_port: client,
            data,
            device_name: Some("packet log".into()),
            captured_at_ms: at.timestamp_millis(),
            src_ip: None,
            dst_ip: None,
            tcp_seq: 0,
            tcp_ack: 0,
        });
    }
    if out.is_empty() {
        return Err(format!("{}: not a pcap, pcapng or packet log", path.display()));
    }
    Ok(out)
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    let hex = hex.trim().as_bytes();
    if hex.len() % 2 != 0 {
        return None;
    }
    let digit = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    hex.chunks(2).map(|pair| Some(digit(pair[0])? << 4 | digit(pair[1])?)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_packet_log_line_reads_as_the_server_sending() {
        let dir = std::env::temp_dir().join(format!("lokthar-engine-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("packets.log");
        std::fs::write(
            &path,
            "# comment\n2026-10-18T21:03:04.250+02:00|Client:50349:13328|0E0036AB\n\
             2026-10-18T21:03:05+02:00|Client:13328|ff\n",
        )
        .unwrap();
        let got = read(&path).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].src_port, got[0].dst_port), (13328, 50349));
        assert_eq!(got[0].data, vec![0x0E, 0x00, 0x36, 0xAB]);
        assert_eq!(got[0].captured_at_ms, 1_792_350_184_250);
        assert_eq!(got[1].src_port, 13328);
        assert_eq!(got[1].captured_at_ms - got[0].captured_at_ms, 750);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
