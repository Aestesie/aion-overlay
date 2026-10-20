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

## Comparison: what upstream gets right that we don't

No Python fixes: this is a personal project with no users on the current release, and Python is replaced in phase 2. Each item below is built correctly into the Rust engine instead (phase 2), except where noted.

### Bugs

1. **Multi-pet soul pickups are dropped.** `0D 90` is `<count u8> n × (pet u32, amount u32)`. `parse_soul` in `aion2_tracker/protocol.py` requires the first byte to be `01` and reads one pet, so a kill that gives souls to two pets counts neither. Return a list; loop over it in `Tracker._soul`. Upstream test: `plugins/decoder.rs`, `[02, pet 1015 amt 1, pet 1120 amt 1]`.
2. **Pet level-up record `14 90` is not read.** Layout: `<skip 2> <pet u32> <level u32>`. If it is newer than ours, set the level and reset souls to 0.
3. **Level-up keeps the remainder.** `level_up()` in `track.py` does `souls -= LEVEL_NEED[level]`; the game resets to 0 (upstream saw a pet come out 2 too high). On a live gain reset to 0; the one-time cleanup of saved data may keep subtracting.

### Gaps

4. **Collections per server, not per character.** The game shares one pet collection across a server's characters (upstream plugin 0.3.1 keys by `server-<id>`). Doing the same lets us drop the "undo the sync within 30 s" logic in `_character`.
5. **Field bosses: Verteron only.** `app/src/renderer/src/data/fieldBossNpcs.json` has 101001–101024. Add Altgard 111001–111024 and Argo (NPC 2600068 → 2001) from upstream `capture/field_bosses.rs`. Upstream also detects kills from spawn/death by NPC code without the map open; useful for the Lokthar sync.
   The data is renderer JSON, not Python, so it can be done at any time.
6. **Capture:** comes for free in phase 1, since we copy upstream's capture layer:
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

Revisit after phase 2, when Python is gone and the engine is a plain crate. At that point a Tauri shell would cost: the Vue renderer moves over mostly as is, the main process gets rewritten in Rust, and we gain a ~10 MB install instead of ~100 MB and one process instead of two.

### Phases

**Phase 0: license (done 2026-10-19).**
- `LICENSE` restored: the GPL-3.0 text (removed by mistake before the history squash). Matches `pyproject.toml` and `app/package.json` (`GPL-3.0-only`) and all three upstream repos (GPL-3.0).
- README: credits for Nyerk (fork origin), A2Tools DPS Meter (parser crate + copied capture code) and A2Tools Plugins (pet rules), and a License section.
- Rule from here on: every file copied from upstream starts with a comment naming its source repo, path and commit, and keeps the upstream copyright line if it has one.

**Phase 1: DPS spike.**
- `engine/` binary: copy and trim upstream's `pcap_capturer.rs`, `combat_port_detector.rs`, `capture_dispatcher.rs` (≈2k lines; drop the logger, share, window detector, Tauri). It loads `wpcap.dll` at runtime, so no SDK at build time.
- Load `src/data/i18n/{npcs,skills}/en.json` and `dot_skill_ids.json` from upstream.
- JSON lines, same style as the Python sidecar:
  - out: `{"type":"dps", ...DpsData}` throttled to ~5/s; `{"type":"details", ...}` on request.
  - in: `dpsReset`, `targetMode`, `details`.
- Electron: spawn it like `tracker.ts` does the Python sidecar; a new overlay window `#/meter` following `windows.ts` (screen-saver level, `showInactive`): rows (name, class, DPS, damage, %), target HP bar, fight timer, reset, target-mode switch.
- The engine and Python capture side by side is fine for a spike.
- First step: a 20-line test crate that builds against the pinned rev and replays a capture (`capture/file_replay.rs` reads `TIMESTAMP|STREAMKEY|HEX_DATA`); compare its numbers to upstream's meter on the same capture.

Status (2026-10-19), built but not yet run against the game:
- `engine/` (`lokthar-engine`): upstream's crate at `08b249d`, their capture files copied and trimmed (header in each), English tables embedded from `engine/data/`. `cargo test`: 16 pass, upstream's capture tests included, plus an end-to-end replay test (a synthetic stream locks onto the game port and comes out as a meter row).
- `lokthar-engine replay <file> [--every <s>] [--mode <mode>]` reads `.pcap`, `.pcapng` and A2Tools packet logs, timed by capture time; prints `dps` lines and a table.
- App: `main/engine.ts` (spawn, restart, commands), `#/meter` window (`MeterPage.vue`), `meter` settings and a Settings section, idle sleeps it with the game, `npm run dist` and CI build and ship the engine.
- To do: run it in game on Windows; validate against upstream's meter (record a fight with A2Tools' packet logging on, note its numbers, replay the log); report an error when no capture device opens (it says "listening" today); a dev replay mode in real time for UI work.

**Phase 2: one sidecar.**
- Port `protocol.py` decoders (pets, Kina, shop, field bosses) to Rust on `frame_tap`; local player id and mob codes come from `DataStorage` (replaces our vote-based `self_id`).
- Pets done right from the start: souls read as a list (bug 1), the `14 90` level-up (bug 2), reset to 0 on level-up (bug 3), collections keyed per server (gap 4). Saved per-character data migrates once into per-server.
- Field bosses: Altgard and Argo (gap 5), kills detected from spawn/death.
- Move the stateful tracking to the engine or to TS; retire Python and PyInstaller.
- Feature parity checklist. Python is retired only when every row works in the engine and the sidecar events below keep their shape, so the Vue app needs no changes:

  | Feature | Record(s) | Event(s) | Upstream has it? |
  |---|---|---|---|
  | Pet collection sync on world entry | `00 90` | `sync`, `ready` | Plugin only |
  | Soul gains (+ level-up) | `0D 90`, `14 90` | `soul` | Plugin only |
  | Genus crystals from maxed pets | `11 90` | `crystal` | No |
  | Character name + server | `33 36` | `character` | Yes (`DataStorage`) |
  | Who you are (self id) | loot credit `04 8D` | — | Yes (`DataStorage`) |
  | Kills / combat ping | `41 36`, `42 36`, `04 38`, `06 38` | `combat` | Yes |
  | Kina balance | `1B 56` | `kina` | No |
  | Black Cloud Merchant stock (pet tracker in the merchant window) | `91 56` | `shop` | No |
  | Field bosses (map list) | `01 91` | `fieldBosses` | Yes (`field_bosses.rs`) |
  | Nearby monsters + your position | `21 36`, `23 36`, `02 38`/`03 38`, spawns | `nearby` | Partly (map id) |
  | Capture state, heartbeat | — | `status`, `heartbeat` | Yes |
  | Manual edits, rename, reset session, capture on/off | commands `set`, `name`, `resetSession`, `capture`, `snapshot` | `pet`, `snapshot` | No |
  | Saved data (`track.py` store) | — | — | No; read the existing JSON file and migrate it |
  | **New:** PvP log + kill feed (see below) | `04 8D`, `45 36`, `33 8A` | `pvpKill` | Records parsed, no feature |

### PvP log and kill feed (new, from Nyerk 0.2.17)

Every player kill around you, as a log tab in the panel and as a kill feed over the game. Reference: `xCROv/aion2-nyerk` at `ddcdc48` (0.2.17), files `aion2_tracker/protocol.py` (`parse_kill_credit`, `parse_player`, `parse_legion`), `aion2_tracker/track.py` (`_pvp_kill`, `_my_legion`), `app/src/main/pvpLog.ts`, `app/src/renderer/src/pages/KillFeedPage.vue`, `app/src/renderer/src/components/panel/PvpLogTab.vue`, `app/src/shared/servers.ts`.

Records:

| Record | Layout | Gives |
|---|---|---|
| `04 8D` kill credit | `<victim varint> <u32> <killer varint> <server u16> <len><name> <len><guild> … <last byte>` | Who got the killing blow, their server and legion. Last byte `01` = the victim was a player. Same opcode we already read for loot credit; summon links carry no name and are skipped. |
| `45 36` player in view | `<entity varint> <4 bytes> 17 <len><name> <u32> <faction 01 02 01 \| 02 02 02> …`, server and legion ~100–120 bytes on as `<server u16> <2 bytes> 00 00 00 00 <server u16> <len><guild>` | The victim's name, faction, server and legion (the kill credit names only the killer). |
| `33 8A` legion | `<entity varint> <legion id u48> <server u16> <len><name>` | A player's legion, yours included; resent every few seconds. |

Upstream's `stream_processor.rs` already parses `04 8D` and legion names (for nicknames), so check `DataStorage` for the victim's name and legion before writing our own `45 36` / `33 8A` decoders.

Logic (Nyerk's `_pvp_kill`):
- Only kill credits with the player-victim byte set.
- Each (victim, killer) pair passed on once per 30 s.
- Players in view and legions cleared on every map load (`21 36`).
- Event: `{"type":"pvpKill","ts","killer":{name,server,guild},"victim":{name,server,guild}|null,"mine","died","legion"}`. `mine` = you got the kill, `died` = you were the victim, `legion` = your legion on either side (legion names compared per server).
- Your legion is learnt from `33 8A` for your entity or from your own kill credit, and saved with the character.

App:
- Main process keeps the log in `<userData>/pvp.json`: up to 50,000 kills (a siege gave ~3,000/h), written 3 s after the last kill so a burst is one write, flushed on quit; Clear empties it.
- IPC: `tracker:pvpKill` per kill, `tracker:pvp` for the whole list on open/clear.
- A PvP Log tab in the panel (filters: mine, my legion) and a kill feed overlay window (`#/killfeed`, same window rules as the others).
- Server tags: id → short name (`1104` KAI, `2104` LUM), learnt as we see them; unknown ids show as numbers.

Order: this is the first Python feature to port in phase 2. It needs no saved state from Python, so it doesn't have to wait for the pet migration.

Nyerk 0.2.17 also has things we don't (to look at during phase 2): effect records `2A 38`/`2B 38` used for your position between zone loads, an addons system (`aion2_tracker/addons.py`, `app/src/main/addons.ts`) with `timers` and `pvp-log` addons, and a `session` event.
- CI: `cargo build --release` in `build.yml`; ship the exe through electron-builder `extraResources`.

Status (2026-10-19), built but not yet run against the game:
- Python is gone: `aion2_tracker/`, `packaging/`, `pyproject.toml`, `data/` and the PyInstaller build removed. The app runs one helper, `lokthar-engine` (4.5 MB), for everything.
- `engine/src/tracker/`: `protocol.rs` (every `protocol.py` record, plus `14 90`, the soul list, kill credits with legion and player-victim, `45 36`, `33 8A`; pet ids, levels and counts checked so misreads give nothing), `mod.rs` (the tracker on the parser's frame tap), `store.rs` (collection v2, per server; v1 migrated once, misread pets dropped, the old file kept as `collection.v1.json`), `data.rs` (pets and droppers from the app's own `pets.json` / `spawns.json`).
- `engine/src/sidecar.rs`: the Python sidecar's events and commands, plus the meter's (`meter` on/off, `dpsReset`, `targetMode`, `details`); `--replay <file> --speed <x>` plays a recording in real time for UI work.
- App: `main/tracker.ts` spawns the engine; `main/meter.ts` handles the meter's events; PvP Log tab, kill feed window and `pvp.json` log copied from Nyerk 0.2.17; the meter shows the engine's status.
- `cargo test`: 28 pass (decoders, tracker rules, migration, capture, an end-to-end replay). A synthetic login + two-pet pickup replayed through the sidecar gave the right sync, souls and level-ups.
- Not yet: in-game check of every parity row on Windows; server tags beyond KAI/LUM (upstream's `src/data/servers.json` has them all); Nyerk's position-from-effects (`2A 38`/`2B 38`) and addons; an error status when no capture device opens.

**Phase 3: extras.** Skill breakdown, fight history, buffs (`abnormal.rs`), ping (`PingTracker`), maybe Linux (their capture supports it).

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

## Keeping up with upstream

Decided 2026-10-19: everything moves to Rust (one language, one source of truth); no long-term Python + Rust split.

- **A2Tools parser crate** (dependency): bump `rev` in `engine/Cargo.toml`, build, replay a capture. Breaks only if an entry point we call changes.
- **A2Tools capture files** (copied): keep them as close to verbatim as possible, and note at the top of each the upstream commit it was copied from. To update: `git diff <old> <new> -- src-tauri/src/capture/pcap_capturer.rs src-tauri/src/capture/combat_port_detector.rs src-tauri/src/combat/capture_dispatcher.rs` in `dps-meter-experiment/`, apply what applies.
- **A2Tools pet-souls plugin** (reference): watch `plugins/pet-souls/manifest.json` for record layouts and `plugin.js` for counting rules.
- **Nyerk (xCROv/aion2-nyerk)** (reference): it publishes whole releases as single commits ("Nyerk 0.2.17"), so diff release to release, look at `protocol.py`, and translate any layout change by hand. Keep our Rust decoders shaped like `protocol.py` (one function per record) so the translation stays direct.

## Reviewing upstream updates with an AI agent

### Where the repos live

All are separate git clones inside `~/code/lokthar/`, gitignored by lokthar's `.gitignore`:

| Folder | Remote | Role for us |
|---|---|---|
| `dps-meter-experiment/` | `git@github.com:taengu/A2Tools-DPS-Meter.git` | Parser crate (dependency) + capture files (copied) |
| `dps-meter-experiment-plugins/` | `git@github.com:taengu/A2Tools-Plugins.git` | Pet-souls record layouts and counting rules (reference) |
| `nyerk-experiment/` | `https://github.com/xCROv/aion2-nyerk.git` | Python decoders and app features: pets, PvP, shop, Kina (reference) |

One-time setup for Nyerk:

```sh
cd ~/code/lokthar
git clone https://github.com/xCROv/aion2-nyerk.git nyerk-experiment
echo "/nyerk-experiment/" >> .gitignore
```

### Last reviewed

Update a row only after its changes have been reviewed (and ported or rejected).

| Repo | Commit | Date | Notes |
|---|---|---|---|
| A2Tools-DPS-Meter | `08b249d` | 2026-10-19 | v2.0.73 |
| A2Tools-Plugins | `8543b46` | 2026-10-19 | pet-souls 0.4.6 |
| aion2-nyerk | `ddcdc48` | 2026-10-19 | Nyerk 0.2.17 |

### Fetching by hand

```sh
cd ~/code/lokthar
for r in dps-meter-experiment dps-meter-experiment-plugins nyerk-experiment; do
  git -C $r pull --ff-only
done
git -C dps-meter-experiment log --oneline 08b249d..HEAD   # use the commits from the table
```

### The prompt

Run it from `~/code/lokthar` (so the agent can see all four repos). Paste as is; it reads the commits from the table above.

~~~text
You are reviewing upstream changes for our Aion 2 overlay. Do not change any code or commit anything: this is a review that ends in a report.

Context:
- Our overlay is ~/code/lokthar/aion-overlay. Read aion-overlay/overlay-plan.md first, all of it: it explains what we take from each upstream repo, which phase we are in, and the "Last reviewed" table of commits.
- Our current code: the Rust engine in aion-overlay/engine/ if it exists, the Python sidecar in aion-overlay/aion2_tracker/ while it does, and the Electron/Vue app in aion-overlay/app/.
- Upstream repos, each a git clone next to it: dps-meter-experiment/ (A2Tools DPS Meter, Rust/Tauri), dps-meter-experiment-plugins/ (A2Tools plugins, mainly plugins/pet-souls), nyerk-experiment/ (Nyerk, Python + Electron, the project ours was forked from).

Steps:
1. In each upstream repo run `git pull --ff-only`. If nyerk-experiment/ is missing, say so and skip it. If a pull fails, report it and continue with what is there.
2. For each repo, list the commits since its "Last reviewed" commit (`git log --oneline <commit>..HEAD`) and read the diffs that can matter to us. Nyerk publishes whole releases as single commits: diff release to release and focus on aion2_tracker/protocol.py, aion2_tracker/track.py and app/src.
3. Sort what changed into these buckets, ignoring the rest (UI polish, Linux/KDE window handling, Discord, uploads, a2tools.app/nyerk.app online features, release bumps):
   a. Game protocol: new opcodes, changed record layouts, new fields. Highest priority: compare every one against our decoders and say whether ours is now wrong.
   b. A2Tools parser core (src-tauri/src/capture/{framing,stream_processor,...}, src-tauri/src/combat/{data_storage,dps_calculator,...}): accuracy fixes we get by bumping the pinned rev in engine/Cargo.toml. Check whether any public function or struct we call changed signature (StreamProcessor, StreamAssembler, DpsCalculator, DpsData, PersonalData, SkillLookup, NpcLookup, PingTracker, capture::frame_tap) and say whether a bump is safe.
   c. A2Tools capture files we copied: src-tauri/src/capture/pcap_capturer.rs, src-tauri/src/capture/combat_port_detector.rs, src-tauri/src/combat/capture_dispatcher.rs. Show the relevant hunks and where they go in our copies.
   d. Pet rules (pet-souls manifest.json and plugin.js, Nyerk's pet code): soul counting, level-ups, collection sync, pet data, drop sources.
   e. Features we don't have yet that fit our overlay (as PvP log did). Say what it does, which records it reads, and roughly how big a port it is.
   f. Data files: npcs, skills, pets, field bosses, server ids. Say which of ours are now out of date.
4. For every item in a–f: what changed (repo, commit, file), whether it affects us, and what we should do (port / bump / ignore), naming our file and function. Don't propose anything you haven't checked against our code.

Report format:
- Summary: 3–5 lines, most important first; say plainly if nothing needs doing.
- One section per bucket that has items; leave empty buckets out.
- Suggested next actions, in order, each small enough to be one commit.
- New "Last reviewed" rows (repo, commit, date, note) for me to paste into the plan once I've decided.
~~~

## Credit

This overlay includes code from A2Tools DPS Meter (github.com/taengu/A2Tools-DPS-Meter), A2Tools Plugins (github.com/taengu/A2Tools-Plugins) and Nyerk (github.com/xCROv/aion2-nyerk), all GPL-3.0. Ours is GPL-3.0-only and open source; see Phase 0 and the README's Credits and License sections.
