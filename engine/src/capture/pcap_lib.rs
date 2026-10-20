// Copied from A2Tools DPS Meter (GPL-3.0), https://github.com/taengu/A2Tools-DPS-Meter
// src-tauri/src/platform/{win32,linux}/pcap.rs at 08b249d49ef18be9ac9b41d8dd35596ae99aacfd.
// Changed: the two merged into one file by cfg; the Npcap installer and
// library_available left out (Lokthar's installer asks for Npcap).

//! Which packet-capture library to load. The API is libpcap's on every OS;
//! on Windows it comes from Npcap.

#[cfg(windows)]
mod os {
    use std::path::Path;

    /// The library `pcap_capturer` loads at runtime (the first of these
    /// that loads).
    pub const LIBRARIES: &[&str] = &["wpcap.dll"];

    /// What to tell the player when it will not load.
    pub const MISSING_HELP: &str = "Is Npcap installed? Download from https://npcap.com";

    /// Whether a read returns at its timeout on a device with no traffic: Npcap's
    /// does.
    pub const READ_TIMES_OUT_WHEN_IDLE: bool = true;

    /// Whether a filter can change while capturing without losing what the
    /// kernel has queued. Not here: Npcap empties its buffer on a new filter
    /// (BIOCSETF), so a lock that narrowed the filter would cut the game's
    /// stream right where it was found. The filter is set once, when the device
    /// opens, and kept (`pcap_capturer`).
    pub const FILTER_CHANGE_KEEPS_QUEUE: bool = false;

    /// Npcap puts `wpcap.dll` in System32 only when it is installed in its
    /// WinPcap-compatible mode; otherwise it lives in `System32\Npcap`, where a
    /// plain load does not look. Npcap's guidance for programs is to add that
    /// folder to the DLL search path, so either kind of install works.
    pub fn prepare() {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::System::LibraryLoader::SetDllDirectoryW;
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
            let folder = Path::new(&root).join("System32").join("Npcap");
            let wide: Vec<u16> = folder.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            // SAFETY: a NUL-terminated path that outlives the call.
            if let Err(e) = unsafe { SetDllDirectoryW(PCWSTR(wide.as_ptr())) } {
                tracing::debug!("SetDllDirectoryW({}) failed: {e}", folder.display());
            }
        });
    }

    /// Devices not worth opening on this OS. None here.
    pub fn skip_device(_name: &str) -> bool {
        false
    }
}

#[cfg(not(windows))]
mod os {
    /// Tried in order. Distributions disagree on the soname: Arch and Fedora ship
    /// `libpcap.so.1`, while Debian and Ubuntu keep the old `libpcap.so.0.8` and
    /// have no `.so.1` at all (only the -dev package adds a bare `libpcap.so`).
    pub const LIBRARIES: &[&str] = &["libpcap.so.1", "libpcap.so.0.8", "libpcap.so"];

    pub const MISSING_HELP: &str = "Install libpcap, then let the engine capture without root: \
`sudo setcap cap_net_raw=ep <path to the engine>`";

    /// Whether a read returns at its timeout on a device with no traffic. Not
    /// here: Linux's packet ring (TPACKET_V3) starts the timeout only once a
    /// packet has arrived, so a quiet device's read blocks until one does, and
    /// its capture filter could not change meanwhile (`pcap_capturer`).
    pub const READ_TIMES_OUT_WHEN_IDLE: bool = false;

    /// Whether a filter can change while capturing without losing what the
    /// kernel has queued: libpcap runs a new filter over the packets already in
    /// the ring rather than dropping them.
    pub const FILTER_CHANGE_KEEPS_QUEUE: bool = true;

    /// Nothing to set up before loading libpcap.
    pub fn prepare() {}

    /// Skip libpcap's pseudo-devices. "any" sees every packet a second time on top
    /// of the real interface it arrived on; the rest carry no IP traffic.
    ///
    /// Container networking too: Docker and Podman give every container a `veth`
    /// pair and every network a `docker0` / `br-<id>` / `podman` bridge. The game,
    /// under Proton, talks through the real interface, so these only add capture
    /// threads.
    pub fn skip_device(name: &str) -> bool {
        name == "any"
            || ["nflog", "nfqueue", "usbmon", "dbus", "bluetooth", "veth", "docker", "br-", "podman"]
                .iter()
                .any(|prefix| name.starts_with(prefix))
    }
}

pub use os::*;
