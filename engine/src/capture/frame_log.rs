//! The packet log (Settings → Developer): every game message the parser reads,
//! one text line each, to find where the game sends something (a boss list, a
//! new feature's data) by matching times with what you did. Marks you add
//! ("opened the map") go in between as their own lines. Unlike a recording
//! (`recorder`), it is the messages after the parser took the stream apart,
//! made to be read and shared, not replayed. Files go to
//! `<data folder>/recordings/packets-<date>.txt`.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

pub struct FrameLog {
    dir: PathBuf,
    /// The file being written, and how many messages so far.
    open: Option<(BufWriter<File>, PathBuf, u64)>,
    /// When the file was last written through, so a copy taken while the log runs is whole.
    flushed_ms: i64,
}

fn time(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .with_timezone(&chrono::Local)
        .format("%H:%M:%S%.3f")
        .to_string()
}

impl FrameLog {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, open: None, flushed_ms: 0 }
    }

    /// Start a new file, named for now (a log already going is kept).
    pub fn start(&mut self) -> Result<PathBuf, String> {
        if let Some((_, path, _)) = &self.open {
            return Ok(path.clone());
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let path = self.dir.join(format!("packets-{}.txt", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
        let mut file = BufWriter::new(File::create(&path).map_err(|e| e.to_string())?);
        writeln!(file, "# Lokthar packet log, started {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S %:z")).map_err(|e| e.to_string())?;
        writeln!(file, "# Each game message: local time | opcode | length | bytes (hex, from the opcode on). Marks: ### time MARK text").map_err(|e| e.to_string())?;
        self.open = Some((file, path.clone(), 0));
        Ok(path)
    }

    /// Finish the file: where it is and how many messages it holds.
    pub fn stop(&mut self) -> Option<(PathBuf, u64)> {
        let (mut file, path, n) = self.open.take()?;
        let _ = file.flush();
        Some((path, n))
    }

    pub fn on(&self) -> bool {
        self.open.is_some()
    }

    /// How many messages the log holds so far.
    pub fn count(&self) -> u64 {
        self.open.as_ref().map_or(0, |(_, _, n)| *n)
    }

    /// One message: its length prefix dropped, the opcode first.
    pub fn note(&mut self, ts: i64, frame: &[u8]) {
        let Some((file, _, n)) = self.open.as_mut() else { return };
        let body = crate::tracker::protocol::opcode_at(frame).and_then(|at| frame.get(at..)).unwrap_or(frame);
        let op = body.get(..2).map_or_else(|| "?? ??".to_string(), |o| format!("{:02x} {:02x}", o[0], o[1]));
        let hex: String = body.iter().map(|b| format!("{b:02x}")).collect();
        if writeln!(file, "{} | {op} | {:5} | {hex}", time(ts), body.len()).is_ok() {
            *n += 1;
        }
        if ts - self.flushed_ms >= 1000 {
            let _ = file.flush();
            self.flushed_ms = ts;
        }
    }

    /// A mark: what you did just now, to find its messages around it.
    pub fn mark(&mut self, ts: i64, text: &str) -> bool {
        let Some((file, _, _)) = self.open.as_mut() else { return false };
        let text: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
        let ok = writeln!(file, "### {} MARK {}", time(ts), if text.is_empty() { "(mark)" } else { &text }).is_ok();
        let _ = file.flush();
        ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_messages_and_marks_as_lines() {
        let dir = std::env::temp_dir().join(format!("lokthar-frames-{}", std::process::id()));
        let mut log = FrameLog::new(dir.clone());
        log.note(1_760_000_000_000, &[5, 1, 0x91, 7]); // not on: nothing
        let path = log.start().unwrap();
        log.note(1_760_000_000_000, &[5, 1, 0x91, 7, 0xff]);
        assert!(log.mark(1_760_000_000_500, "opened the map\n"));
        assert_eq!(log.stop().map(|(_, n)| n), Some(1));
        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().filter(|l| !l.starts_with("# ")).collect();
        assert!(lines[0].ends_with("| 01 91 |     4 | 019107ff"), "{}", lines[0]);
        assert!(lines[1].starts_with("### ") && lines[1].ends_with("MARK opened the map"), "{}", lines[1]);
        let _ = fs::remove_dir_all(dir);
    }
}
