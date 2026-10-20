//! Recording the game's traffic, for replaying a fight after a game patch
//! (`--replay`): what came from the game's port after the lock, as A2Tools DPS
//! Meter's packet log (one line per segment, `TIMESTAMP|Client:<client
//! port>:<server port>|HEX`), which `recording::read` reads back and A2Tools
//! DPS Meter's own replay reads too. Files go to `<data folder>/recordings`.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use a2tools_dps_meter_lib::capture::captured_payload::CapturedPayload;
use serde_json::{Value, json};

pub struct Recorder {
    dir: PathBuf,
    /// The file being written, and how many segments so far.
    open: Option<(BufWriter<File>, PathBuf, u64)>,
}

impl Recorder {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, open: None }
    }

    pub fn recording(&self) -> Option<&PathBuf> {
        self.open.as_ref().map(|(_, path, _)| path)
    }

    /// Start a new file, named for now (a recording already going is kept).
    pub fn start(&mut self) -> Result<PathBuf, String> {
        if let Some((_, path, _)) = &self.open {
            return Ok(path.clone());
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let path = self.dir.join(format!("{}.log", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
        let mut file = BufWriter::new(File::create(&path).map_err(|e| e.to_string())?);
        writeln!(file, "# Lokthar recording: the game's traffic after the lock (A2Tools DPS Meter's packet log)").map_err(|e| e.to_string())?;
        self.open = Some((file, path.clone(), 0));
        Ok(path)
    }

    /// Finish the file: where it is and how many segments it holds.
    pub fn stop(&mut self) -> Option<(PathBuf, u64)> {
        let (mut file, path, n) = self.open.take()?;
        let _ = file.flush();
        Some((path, n))
    }

    /// Keep one segment, if it came from the game's port (`port`, once locked).
    pub fn note(&mut self, p: &CapturedPayload, port: Option<u16>) {
        let Some((file, _, n)) = self.open.as_mut() else { return };
        if port != Some(p.src_port) || p.data.is_empty() {
            return;
        }
        let at = chrono::DateTime::from_timestamp_millis(p.captured_at_ms).unwrap_or_default();
        let hex: String = p.data.iter().map(|b| format!("{b:02x}")).collect();
        if writeln!(file, "{}|Client:{}:{}|{hex}", at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true), p.dst_port, p.src_port).is_ok() {
            *n += 1;
        }
    }

    /// The recordings kept, newest first, and the one being written:
    /// `{"dir", "recording": path | null, "files": [{"name", "path", "bytes", "modified": ms}]}`.
    pub fn list(&self) -> Value {
        let mut files: Vec<(i64, Value)> = fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "log"))
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
                let path = e.path();
                Some((modified, json!({ "name": e.file_name().to_string_lossy(), "path": path.display().to_string(), "bytes": meta.len(), "modified": modified })))
            })
            .collect();
        files.sort_by_key(|f| -f.0);
        json!({
            "dir": self.dir.display().to_string(),
            "recording": self.recording().map(|p| p.display().to_string()),
            "files": files.into_iter().map(|f| f.1).collect::<Vec<_>>(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recording_reads_back_as_what_came_from_the_game() {
        let dir = std::env::temp_dir().join(format!("lokthar-rec-{}", std::process::id()));
        let mut rec = Recorder::new(dir.clone());
        let path = rec.start().unwrap();
        let payload = |src: u16, dst: u16, data: &[u8]| CapturedPayload {
            src_port: src,
            dst_port: dst,
            data: data.to_vec(),
            device_name: None,
            captured_at_ms: 1_760_000_000_123,
            src_ip: None,
            dst_ip: None,
            tcp_seq: 0,
            tcp_ack: 0,
        };
        rec.note(&payload(7777, 50123, &[1, 2, 0xab]), None); // before the lock: not kept
        rec.note(&payload(7777, 50123, &[1, 2, 0xab]), Some(7777));
        rec.note(&payload(50123, 7777, &[9]), Some(7777)); // to the game: not kept
        assert_eq!(rec.stop().map(|(_, n)| n), Some(1));
        let back = crate::capture::recording::read(&path).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!((back[0].src_port, back[0].dst_port, back[0].data.as_slice(), back[0].captured_at_ms), (7777, 50123, &[1u8, 2, 0xab][..], 1_760_000_000_123));
        assert_eq!(rec.list()["files"].as_array().map(Vec::len), Some(1));
        let _ = fs::remove_dir_all(dir);
    }
}
