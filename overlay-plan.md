# Overlay plan: pet tracker fixes + DPS meter

Written 2026-10-19. A working plan, not documentation of what exists.

## The three repos

All three live inside `~/code/lokthar/`, gitignored there, each its own git repo:

| Folder | Repo | What it is |
|---|---|---|
| `aion-overlay/` | github.com/matiasmoya/aion-overlay | **This repo.** Electron + Vue overlay (`app/`) with a Python capture sidecar (`aion2_tracker/`, scapy + Npcap) talking JSON lines over stdin/stdout. Windows only. Based on xCROv/aion2-nyerk. |
| `dps-meter-experiment/` | github.com/taengu/A2Tools-DPS-Meter | Upstream DPS meter. Tauri 2 + Rust + vanilla JS, GPL-3.0. Windows and Linux. |
| `dps-meter-experiment-plugins/` | github.com/taengu/A2Tools-Plugins | Their plugins; `plugins/pet-souls` is the equivalent of our pet tracker. |

## How upstream is built

- Capture (desktop only, behind the `desktop` cargo feature):
  `capture/pcap_capturer.rs` → `capture/combat_port_detector.rs` → `combat/capture_dispatcher.rs`.
- Parser core (no Tauri, no tokio; CI checks it builds for `wasm32-unknown-unknown` because their log service runs it too):
  `capture/{framing, stream_assembler, stream_processor}` → `combat/data_storage` → `combat/dps_calculator`.
- Plugins declare byte layouts in `manifest.json`; the meter decodes those frames (`plugins/decoder.rs`) and hands the fields to the plugin. Every decoded frame also goes through the global hook `capture::frame_tap::set(...)`.
- Cargo features: `desktop` (Tauri, pcap, tokio) and `online` (reqwest, Discord, uploads). `build.rs` only runs `tauri_build` under `desktop`.

Verified locally: `cargo check --lib --no-default-features` in `dps-meter-experiment/src-tauri` builds (rustc 1.99.1).

### The engine API we would call

```rust
let storage = Arc::new(DataStorage::new());
let skills  = Arc::new(SkillLookup::load_from_json(&skills_json)?);
let npcs    = Arc::new(NpcLookup::load_from_json(&npcs_json)?);
let mut proc = StreamProcessor::new(storage.clone(), skills.clone(), npcs.clone());
proc.set_dot_skill_ids(dot_ids);
proc.set_override_timestamp(Some(capture_ms));     // time hits by capture time
assembler.process_chunk(&tcp_payload, &mut proc);  // StreamAssembler

let calc = DpsCalculator::new(storage, skills, npcs, Arc::new(PingTracker::new()));
calc.set_target_selection_mode("bossTargets");     // mostDamage | mostRecent | lastHitByMe | allTargets | trainTargets
let dps: DpsData = calc.get_dps();                 // serde, camelCase
calc.get_target_details(target, actors);           // per-skill breakdown
calc.restart_target_selection(clear);              // reset
```

`DpsData` carries, per actor id: job, dps, amount, damage contribution, nickname, combat power, gear score, hps and heal amount. Fight-wide it carries the target's name, id, max/current HP and boss flag, the battle time, the local player id, the dungeon id and the party.

Check signatures against the pinned rev before coding. These entry points have not changed since April 2026 (see "Upstream stability").

## Comparison: what to fix or copy in our Python sidecar (phase 1)

### Bugs

1. **Multi-pet soul pickups are dropped.** `0D 90` is `<count u8> n × (pet u32, amount u32)`. `parse_soul` in `aion2_tracker/protocol.py` requires the first byte to be `01` and reads one pet, so a kill that gives souls to two pets counts neither. Return a list; loop over it in `Tracker._soul`. Upstream test: `plugins/decoder.rs`, `[02, pet 1015 amt 1, pet 1120 amt 1]`.
2. **Pet level-up record `14 90` is not read.** Layout: `<skip 2> <pet u32> <level u32>`. If it is newer than ours, set the level and reset souls to 0.
3. **Level-up keeps the remainder.** `level_up()` in `track.py` does `souls -= LEVEL_NEED[level]`; the game resets to 0 (upstream saw a pet come out 2 too high). On a live gain reset to 0; the one-time cleanup of saved data may keep subtracting.

### Gaps

4. **Collections per server, not per character.** The game shares one pet collection across a server's characters (upstream plugin 0.3.1 keys by `server-<id>`). Doing the same lets us drop the "undo the sync within 30 s" logic in `_character`.
5. **Field bosses: Verteron only.** `app/src/renderer/src/data/fieldBossNpcs.json` has 101001–101024. Add Altgard 111001–111024 and Argo (NPC 2600068 → 2001) from upstream `capture/field_bosses.rs`. Upstream also detects kills from spawn/death by NPC code without the map open; useful for the Lokthar sync.
6. **Capture:**
   - BPF filter `ip and tcp and not port 80 and not port 443` instead of `tcp`.
   - Rescan adapters every 15 s (a VPN or ping reducer started later is never seen today).
   - Prefer a loopback flow, with a 2.5 s grace before locking a physical one (ping reducers).

### Already in line with upstream

- Opcodes as of June 2026, the frame-length rule (`len − 4 + varint bytes`), the bundle format, skipping TLS records.
- Following the game to a new connection (ours 2026-10-15, theirs 2026-10-19).
- Pet list counts read as varints.
- `data/npcs_en.json` is byte-identical to theirs; our 207 pets match their names and genus.

### Optional

- Their `sources.js` (built from the game client's tables): drop chance, spawn counts, nearest Kibelisk, chests, ten languages.

## DPS meter: plan

### Decision: depend on their crate, don't port it

The parser and aggregation are about 10k lines of heuristics (`stream_processor` 4.4k, `data_storage` 3.9k, `dps_calculator` 2.5k, `abnormal` 1.2k) and change daily. A Python port would drift within a week, and Python already struggles with the packet rate.

Instead: a Rust sidecar in `engine/` that depends on their crate, pinned:

```toml
[dependencies]
a2tools-dps-meter = { git = "https://github.com/taengu/A2Tools-DPS-Meter", rev = "<pinned>", default-features = false }
```

No `desktop` means no Tauri; no `online` means no uploads, which keeps our "no network" promise.

### Decision: keep Electron (for now)

The integration boundary is the sidecar either way: Electron or Tauri, the engine is the same Rust binary/crate. Pivoting now would mean rewriting our main process (`tracker.ts`, `windows.ts`, `idle.ts`, the IPC, tray, packaging) for no feature gain, and upstream's front end is vanilla JS, so pivoting does not let us reuse their UI either. Their Linux commit log (KWin rules, focus stealing, compositor resizing) shows Tauri overlays have their own platform fights.

Revisit after phase 3, when Python is gone and the engine is a plain crate. At that point a Tauri shell would cost: the Vue renderer moves over mostly as is, the main process gets rewritten in Rust, and we gain a ~10 MB install instead of ~100 MB and one process instead of two.

### Phases

**Phase 1: Python fixes (0.3.x).** Items 1–6 above.

**Phase 2: DPS spike.**
- `engine/` binary: copy and trim upstream's `pcap_capturer.rs`, `combat_port_detector.rs`, `capture_dispatcher.rs` (≈2k lines; drop the logger, share, window detector, Tauri). It loads `wpcap.dll` at runtime, so no SDK at build time.
- Load `src/data/i18n/{npcs,skills}/en.json` and `dot_skill_ids.json` from upstream.
- JSON lines, same style as the Python sidecar:
  - out: `{"type":"dps", ...DpsData}` throttled to ~5/s; `{"type":"details", ...}` on request.
  - in: `dpsReset`, `targetMode`, `details`.
- Electron: spawn it like `tracker.ts` does the Python sidecar; a new overlay window `#/meter` following `windows.ts` (screen-saver level, `showInactive`): rows (name, class, DPS, damage, %), target HP bar, fight timer, reset, target-mode switch.
- The engine and Python capture side by side is fine for a spike.
- First step: a 20-line test crate that builds against the pinned rev and replays a capture (`capture/file_replay.rs` reads `TIMESTAMP|STREAMKEY|HEX_DATA`); compare its numbers to upstream's meter on the same capture.

**Phase 3: one sidecar.**
- Port `protocol.py` decoders (pets, Kina, shop, field bosses) to Rust on `frame_tap`; local player id and mob codes come from `DataStorage` (replaces our vote-based `self_id`).
- Move the stateful tracking to the engine or to TS; retire Python and PyInstaller.
- CI: `cargo build --release` in `build.yml`; ship the exe through electron-builder `extraResources`.

**Phase 4: extras.** Skill breakdown, fight history, buffs (`abnormal.rs`), ping (`PingTracker`), maybe Linux (their capture supports it).

### Risks

- **Their crate is not a library API.** Pin the rev, keep a thin adapter module, update deliberately (see below).
- **Skill icons** come from NCSoft's CDN (assets.playnccdn.com). Bundle them or skip them to keep "no requests".
- **GPL:** both projects are GPL-3.0-only. Credit upstream in the README and keep a LICENSE file in the repo.

## Upstream stability

Measured 2026-10-19 over the previous 30 days: 631 commits, 9 releases (2.0.65 → 2.0.73). The project started 2026-04-02.

Where the churn goes:

| Area | Commits / 30 d | What it is |
|---|---|---|
| `src/` (front end) | 162 | Replay, Details, themes, settings UI |
| `platform/` | 76 | Linux/KDE/Hyprland windows, keybinds, Discord |
| `combat/data_storage.rs` | 68 | Identity, party, names, fight saving |
| `capture/stream_processor.rs` | 60 | Parser heuristics |
| `combat/dps_calculator.rs` | 53 | Target selection, world bosses, heals |
| `capture_dispatcher` / `pcap_capturer` / port detector | 15 / 11 / 3 | Capture filter, follow a new connection |
| `capture/framing.rs` | 6 | |
| `capture/stream_assembler.rs` | 0 | |

`Cargo.toml` changes are almost all version bumps. No game opcode change in that window.

The parser commits are accuracy fixes and new readings, not API changes: crits reading the wrong value, party members on another world, ground spells linked to casters, a pet naming its owner when the owner's spawn was missed, DoT names, Odyle energy, world boss HP over 100 million, abyss cores and artifacts.

The entry points we call (`StreamProcessor::new`, `consume_stream`, `process_chunk`, `DpsCalculator::new`, `get_dps`, target modes, `load_from_json`) last changed in April 2026. `DpsData`/`PersonalData` did not change in the 30 days.

So: the API we touch is stable; what moves is accuracy. Bumping the pin every week or two picks up the fixes. A game patch that changes opcodes will break both projects the same day, and upstream will usually fix it first.

## Credit

This overlay will include code from A2Tools DPS Meter (github.com/taengu/A2Tools-DPS-Meter) and A2Tools Plugins (github.com/taengu/A2Tools-Plugins), both GPL-3.0, and is itself open source. License compliance details to be finished before the first release that ships their code.
