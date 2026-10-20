//! The overlay's own tracking, on the frames the parser reads (its frame tap):
//! the pet collection and its souls, crystals, Kina, the Black Cloud Merchant,
//! field bosses, what is around you, and player kills. Ported from the Python
//! tracker (`track.py`, from Nyerk), with the pet rules of A2Tools' pet-souls
//! plugin and one collection per game server.
//!
//! Events go out as JSON (the sidecar prints them); the shapes are the Python
//! tracker's, documented in main.rs.

pub mod data;
pub mod protocol;
pub mod store;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::i18n::lookup::NpcLookup;
use serde_json::{Value, json};

use data::PetData;
use protocol as p;
use store::{LEVEL_NEED, MAX_LEVEL, Pet, Store};

/// How long before a soul or crystal its kill can be (the credit comes ~0.3 s before).
const NAME_WINDOW_MS: i64 = 1500;
/// A "combat" event at most this often: the overlay only needs to know fighting is going on.
const COMBAT_EVERY_MS: i64 = 5000;
/// The collection comes just before the record naming the character, in the
/// same bundle: it waits this long for it, then goes to the one playing.
const SYNC_WAIT_MS: i64 = 5000;
/// A player kill is passed on once per killer and victim in this long.
const PVP_REPEAT_MS: i64 = 30_000;
/// A cast's target this close to where you are is no news of where you are.
const CAST_RANGE: f32 = 2500.0;
/// Faster than this between two places under MAX_JUMP_MS apart is a misread,
/// not you (5,400/s mounted or dashing, in Nyerk's captures).
const MAX_SPEED: f32 = 10_000.0;
const MAX_JUMP_MS: i64 = 2000;
/// The object templates that are Hidden Cubes, with the game's asset name of
/// each, from benhighlanderr/Aion2-Hidden-Cube-Radar (`HIDDEN_CUBE_IDS` in
/// aion2_radar.py). 1200039 and 1200041 (Verteron) were also seen opened in
/// dr89mh/aion2-cube-radar's captures (FINDINGS B5, B9); the rest are that
/// list's alone. Each zone and version of a cube has its own.
const CUBE_TEMPLATES: [u32; 26] = [
    1_000_295, // Basic_HiddenCube_01
    1_000_548, // Basic_HiddenCube_01_V01
    1_000_556, // Basic_HiddenCube_01_V02
    1_000_568, // Basic_HiddenCube_01_V03
    1_000_566, // Basic_HiddenCube_01_V04
    1_000_567, // Basic_HiddenCube_01_V05
    1_100_056, // E_FE_TB_HiddenCube_01
    1_100_094, // E_FE_SpecterEvasion_HiddenCube_01
    1_200_018, // E_HiddenCube_01_001
    1_200_036, // E_HiddenCube_01_001
    1_200_037, // E_HiddenCube_01_002
    1_200_039, // E_HiddenCube_01_V04_001 (Verteron)
    1_200_040, // E_HiddenCube_01_V04_002
    1_200_041, // E_HiddenCube_01_V04_003 (Verteron)
    1_200_667, // E_HiddenCube_01_003
    1_200_707, // E_L1_FE_SpecterEvasion_HiddenCube_01
    1_201_054, // E_HiddenCube_01_004
    1_201_055, // E_HiddenCube_01_005
    1_300_081, // E_D1_TreasureBoxRare_001 (Asmodian)
    1_300_082, // E_D1_TreasureBoxLegend_001 (Asmodian)
    1_300_754, // E_D1_HiddenCube_01 (Asmodian)
    1_301_199, // E_D1_TreasureBoxRare_002 (Asmodian, V04)
    1_301_200, // E_D1_HiddenCube_02 (Asmodian, V04)
    1_401_335, // E_HiddenCube_01_006
    1_401_336, // E_HiddenCube_01_007
    3_682_560, // Special_HiddenCube
];

pub type Emit = Box<dyn Fn(Value) + Send + Sync>;

pub struct Tracker {
    store: Store,
    /// Where the collection is saved; None: never (a replay).
    path: Option<PathBuf>,
    pets: &'static PetData,
    npcs: Arc<NpcLookup>,
    storage: Arc<DataStorage>,
    emit: Emit,

    /// Each character's souls this session, by pet.
    sessions: HashMap<String, HashMap<u32, u32>>,
    /// entity -> monster code, for every spawn seen
    mob_code: HashMap<u32, u32>,
    /// Kills: (ms, monster entity)
    recent: VecDeque<(i64, u32)>,
    /// Kill credits: (ms, monster entity, player credited)
    credits: VecDeque<(i64, u32, u32)>,
    /// Which player is you, by the credits just before your souls: for when
    /// the parser has not learnt it from the game's own records.
    self_votes: HashMap<u32, u32>,
    last_combat: i64,
    /// The collection waiting for the record that names the character.
    pending_sync: Option<(i64, p::Collection)>,
    field_bosses: Option<(u32, Vec<p::FieldBoss>)>,

    /// Around you: monsters loaded (entity -> code), your zone and position (x, -y).
    visible: HashMap<u32, u32>,
    world: Option<u32>,
    position: Option<(f32, f32)>,
    /// When the position was last set, and whether from where you stand (a
    /// zone load, a teleport, an effect on you) rather than a cast's target.
    position_ms: i64,
    position_exact: bool,
    pub nearby_dirty: bool,

    /// The Hidden Cubes in view (sent once you are within about 100 m): object id -> cube.
    cubes: HashMap<u32, p::ObjectSpawn>,
    /// Players in view and their legions, for the kill feed; cleared on each zone load.
    players: HashMap<u32, p::Player>,
    legions: HashMap<u32, String>,
    /// Your entity in this zone (from your own record).
    self_entity: Option<u32>,
    pvp_seen: HashMap<(u32, u32), i64>,
}

fn pet_view(id: u32, pet: &Pet, name: Option<&str>, session: u32) -> Value {
    json!({
        "id": id,
        "name": name,
        "souls": pet.souls,
        "level": pet.level.unwrap_or(0),
        "levelEstimated": pet.level.is_none() || pet.level_estimated,
        "crystals": pet.crystals,
        "session": session,
    })
}

impl Tracker {
    pub fn new(store: Store, path: Option<PathBuf>, npcs: Arc<NpcLookup>, storage: Arc<DataStorage>, emit: Emit) -> Self {
        Self {
            store,
            path,
            pets: data::pets(),
            npcs,
            storage,
            emit,
            sessions: HashMap::new(),
            mob_code: HashMap::new(),
            recent: VecDeque::new(),
            credits: VecDeque::new(),
            self_votes: HashMap::new(),
            last_combat: i64::MIN,
            pending_sync: None,
            field_bosses: None,
            visible: HashMap::new(),
            world: None,
            position: None,
            position_ms: 0,
            position_exact: false,
            nearby_dirty: false,
            cubes: HashMap::new(),
            players: HashMap::new(),
            legions: HashMap::new(),
            self_entity: None,
            pvp_seen: HashMap::new(),
        }
    }

    fn save(&self) {
        if let Some(path) = &self.path {
            if let Err(e) = self.store.save(path) {
                tracing::warn!("could not save the collection: {e}");
            }
        }
    }

    fn session(&self, pet: u32) -> u32 {
        let name = self.store.current.clone().unwrap_or_default();
        self.sessions.get(&name).and_then(|s| s.get(&pet)).copied().unwrap_or(0)
    }

    pub fn view(&self, id: u32) -> Value {
        let pet = self.store.pets().and_then(|p| p.get(&id)).cloned().unwrap_or_default();
        pet_view(id, &pet, self.store.name(id), self.session(id))
    }

    /// Every pet of the collection playing, as the overlay sees them.
    pub fn snapshot(&self) -> Value {
        Value::Array(self.store.pets().into_iter().flatten().map(|(&id, _)| self.view(id)).collect())
    }

    pub fn character(&self) -> Value {
        match &self.store.current {
            Some(name) => json!({ "name": name, "server": self.store.characters.get(name).and_then(|c| c.server) }),
            None => Value::Null,
        }
    }

    /// Which entity is you: the game's own word (the parser's), else the votes.
    fn me(&self) -> Option<u32> {
        self.storage
            .local_player_id()
            .map(|id| id as u32)
            .or(self.self_entity)
            .or_else(|| self.self_votes.iter().max_by_key(|(_, n)| **n).map(|(id, _)| *id))
    }

    fn npc_name(&self, code: u32) -> Option<String> {
        let name = self.npcs.get_npc_name(code as i32);
        (!name.is_empty() && name.parse::<i64>().is_err()).then_some(name)
    }

    /// Nothing is around you any more, and entity ids start over (the game closed).
    pub fn forget_view(&mut self) {
        self.visible.clear();
        self.mob_code.clear();
        self.credits.clear();
        self.recent.clear();
        self.self_votes.clear();
        self.players.clear();
        self.legions.clear();
        self.self_entity = None;
        self.clear_cubes();
        self.world = None;
        self.position = None;
        self.position_exact = false;
        self.nearby_dirty = true;
    }

    /// The cubes in view, as the overlay shows them: where (the map data's x, -y), how high,
    /// and since when they exist.
    pub fn cubes(&self) -> Value {
        let mut list: Vec<&p::ObjectSpawn> = self.cubes.values().collect();
        list.sort_by_key(|c| c.id);
        Value::Array(
            list.into_iter()
                .map(|c| {
                    json!({
                        "id": c.id, "template": c.template, "position": [c.x.round() as i64, (-c.y).round() as i64],
                        "height": c.z.round() as i64, "createdAt": c.created_ms,
                    })
                })
                .collect(),
        )
    }

    fn cubes_changed(&self, ts: i64) {
        (self.emit)(json!({ "type": "cubes", "ts": ts, "cubes": self.cubes() }));
    }

    fn clear_cubes(&mut self) {
        if !self.cubes.is_empty() {
            self.cubes.clear();
            (self.emit)(json!({ "type": "cubes", "cubes": [] }));
        }
    }

    /// You are at game (x, y): kept as the map data's (x, -y).
    fn move_to(&mut self, ts: i64, x: f32, y: f32, exact: bool) {
        self.position = Some((x, -y));
        self.position_ms = ts;
        self.position_exact = exact;
        self.nearby_dirty = true;
    }

    /// Game (x, y) is too far from your last place for the time since: a misread.
    fn jump(&self, ts: i64, x: f32, y: f32) -> bool {
        let dt = ts - self.position_ms;
        let Some((px, py)) = self.position else { return false };
        dt < MAX_JUMP_MS && ((px - x).hypot(py + y)) > MAX_SPEED * (dt.max(50) as f32 / 1000.0)
    }

    pub fn nearby(&mut self) -> Value {
        self.nearby_dirty = false;
        let mut counts: HashMap<u32, u32> = HashMap::new();
        for code in self.visible.values() {
            *counts.entry(*code).or_default() += 1;
        }
        let mut monsters: Vec<(u32, u32)> = counts.into_iter().collect();
        monsters.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        json!({
            "world": self.world,
            "position": self.position.map(|(x, y)| [x.round() as i64, y.round() as i64]),
            "monsters": monsters.into_iter().map(|(npc, count)| json!({ "npc": npc, "count": count })).collect::<Vec<_>>(),
        })
    }

    pub fn reset_session(&mut self) {
        let name = self.store.current.clone().unwrap_or_default();
        self.sessions.remove(&name);
    }

    pub fn set_souls(&mut self, id: u32, souls: u32) -> Value {
        self.store.pets_mut().entry(id).or_default().souls = souls;
        self.save();
        self.view(id)
    }

    pub fn set_name(&mut self, id: u32, name: &str) -> Value {
        // A name given by hand outvotes any learned one.
        self.store.names.insert(id, [(name.to_string(), 1_000_000)].into());
        self.save();
        self.view(id)
    }

    /// One game frame, as the parser read it; `ts` is its capture time (ms).
    pub fn frame(&mut self, ts: i64, f: &[u8]) {
        if let Some((at, _)) = &self.pending_sync {
            if ts - at > SYNC_WAIT_MS {
                let (_, coll) = self.pending_sync.take().unwrap();
                self.sync(ts, &coll);
            }
        }
        let Some(op) = p::opcode(f) else { return };

        for credit in p::kill_credits(f) {
            self.kill_credit(ts, &credit);
        }
        match op {
            p::OP_SPAWN => {
                if let Some(s) = p::spawn(f) {
                    match s.mob_code {
                        Some(code) => {
                            self.mob_code.insert(s.entity, code);
                            self.visible.insert(s.entity, code);
                            self.nearby_dirty = true;
                        }
                        None => {
                            self.mob_code.remove(&s.entity);
                        }
                    }
                }
            }
            p::OP_OBJECT_SPAWN => {
                if let Some(o) = p::object_spawn(f) {
                    if CUBE_TEMPLATES.contains(&o.template) && self.cubes.insert(o.id, o).is_none() {
                        tracing::info!("hidden cube {} (template {}) at {:.0}, {:.0}", o.id, o.template, o.x, o.y);
                        self.cubes_changed(ts);
                    }
                }
            }
            p::OP_OBJECT_REMOVED => {
                // Opened (04) or out of range (01): either way not there for you any more.
                if let Some((id, reason)) = p::object_removed(f) {
                    if self.cubes.remove(&id).is_some() {
                        tracing::info!("hidden cube {id} gone (reason {reason})");
                        self.cubes_changed(ts);
                    }
                }
            }
            p::OP_DEATH => {
                if let Some((entity, flag)) = p::death(f) {
                    // Any 42 36 takes a monster out of view: 1 out of range, 3 killed, 7 gone.
                    if self.visible.remove(&entity).is_some() {
                        self.nearby_dirty = true;
                    }
                    if flag == p::DEATH_FLAG_COMBAT && self.mob_code.contains_key(&entity) {
                        self.push_recent(ts, entity);
                    }
                }
            }
            p::OP_MAP_LOAD => {
                if let Some((world, x, y)) = p::map_load(f) {
                    // A new zone: nothing from the last one is around you any more.
                    // Another zone: its cubes are not around you. The same zone again
                    // (a teleport inside it) keeps them; the server removes what is out of range.
                    if self.world != Some(world) {
                        self.clear_cubes();
                    }
                    self.world = Some(world);
                    self.move_to(ts, x, y, true);
                    self.visible.clear();
                    self.players.clear();
                    self.legions.clear();
                    self.nearby_dirty = true;
                }
            }
            p::OP_TELEPORT => {
                if let Some((x, y)) = p::self_teleport(f) {
                    self.move_to(ts, x, y, true);
                }
            }
            op if p::OP_EFFECTS.contains(&op) => {
                // Effects on you, whoever put them there: where you are, between zone loads.
                if let Some((target, x, y)) = p::effect_position(f) {
                    if Some(target) == self.me() && !self.jump(ts, x, y) {
                        self.move_to(ts, x, y, true);
                    }
                }
            }
            op if p::OP_CASTS.contains(&op) => {
                // Your casts give where their target is: only a guess at where you
                // are, taken when nothing better is known or it is far from it.
                if let Some((actor, x, y)) = p::cast(f) {
                    let near = self.position.is_some_and(|(px, py)| (px - x).hypot(py + y) <= CAST_RANGE);
                    if Some(actor) == self.me() && !(self.position_exact && near) && !self.jump(ts, x, y) {
                        self.move_to(ts, x, y, false);
                    }
                }
            }
            p::OP_SELF => {
                if let Some(who) = p::character(f) {
                    self.self_entity = Some(who.entity);
                    self.character_seen(ts, who);
                }
            }
            p::OP_SOUL => {
                if let Some(list) = p::souls(f) {
                    self.souls(ts, &list);
                }
            }
            p::OP_LEVEL_UP => {
                if let Some((pet, level)) = p::level_up(f) {
                    self.level_up(pet, level);
                }
            }
            p::OP_CRYSTAL => {
                if let Some(c) = p::crystal(f) {
                    self.crystal(ts, &c);
                }
            }
            p::OP_COLLECTION => {
                if let Some(coll) = p::collection(f) {
                    self.pending_sync = Some((ts, coll));
                }
            }
            p::OP_ITEM => {
                if let Some(balance) = p::kina(f) {
                    // The balance as is: the app works out what was earned from the changes.
                    (self.emit)(json!({ "type": "kina", "ts": ts, "balance": balance }));
                }
            }
            p::OP_FIELD_BOSSES => {
                if let Some(list) = p::field_bosses(f) {
                    if self.field_bosses.as_ref() != Some(&list) {
                        (self.emit)(json!({
                            "type": "fieldBosses", "ts": ts, "world": list.0,
                            "bosses": list.1.iter().map(|b| json!({ "id": b.id, "up": b.up, "at": b.at_ms })).collect::<Vec<_>>(),
                        }));
                        self.field_bosses = Some(list);
                    }
                }
            }
            p::OP_SHOP => {
                if let Some((tab, items, next)) = p::shop(f) {
                    // As the tab shows it: the app knows which items are pets worth buying.
                    (self.emit)(json!({ "type": "shop", "ts": ts, "tab": tab, "nextAt": next, "items": items }));
                }
            }
            p::OP_PLAYER => {
                if let Some(player) = p::player(f) {
                    self.players.insert(player.entity, player);
                }
            }
            p::OP_LEGION => {
                if let Some((entity, name)) = p::legion(f) {
                    if Some(entity) == self.me() {
                        self.my_legion(&name);
                    }
                    self.legions.insert(entity, name);
                }
            }
            _ => {}
        }
    }

    fn push_recent(&mut self, ts: i64, mob: u32) {
        self.recent.push_back((ts, mob));
        if self.recent.len() > 64 {
            self.recent.pop_front();
        }
    }

    fn kill_credit(&mut self, ts: i64, credit: &p::KillCredit) {
        if self.mob_code.contains_key(&credit.victim) {
            self.push_recent(ts, credit.victim);
            self.credits.push_back((ts, credit.victim, credit.killer));
            if self.credits.len() > 32 {
                self.credits.pop_front();
            }
        }
        // Your kills (anyone's until it is known which player you are): fighting is going on.
        let me = self.me();
        if (me.is_none() || me == Some(credit.killer)) && ts - self.last_combat >= COMBAT_EVERY_MS {
            self.last_combat = ts;
            (self.emit)(json!({ "type": "combat", "ts": ts }));
        }
        if credit.player_victim && (1000..=9999).contains(&credit.server) {
            self.pvp_kill(ts, credit);
        }
    }

    /// A character entered the world. Collections are per server: a character
    /// on another server than the last one plays that server's collection.
    fn character_seen(&mut self, ts: i64, who: p::Character) {
        let old_key = self.store.key();
        let old = self.store.current.replace(who.name.clone());
        self.store.characters.entry(who.name.clone()).or_default().server = Some(who.server);
        self.store.adopt_unknown();
        let changed = old.as_deref() != Some(who.name.as_str()) || old_key != self.store.key();
        if changed {
            self.save();
            tracing::info!("character: {} on {}{}", who.name, who.server, old.as_ref().map(|o| format!(" (was {o})")).unwrap_or_default());
            (self.emit)(json!({
                "type": "character", "ts": ts, "name": who.name, "server": who.server,
                "switched": old.is_some(), "pets": self.snapshot(),
            }));
        }
        if let Some((_, coll)) = self.pending_sync.take() {
            self.sync(ts, &coll);
        }
    }

    /// Entering the world sends the whole collection: the server's numbers for every pet.
    fn sync(&mut self, ts: i64, coll: &p::Collection) {
        let levels: HashMap<u32, u32> = coll.levels.iter().copied().collect();
        let souls: HashMap<u32, u32> = coll.souls.iter().copied().collect();
        let mut corrected = Vec::new();
        let mut ids: Vec<u32> = levels.keys().chain(souls.keys()).copied().collect();
        ids.sort_unstable();
        ids.dedup();
        for id in ids {
            let name = self.store.name(id).map(str::to_string);
            let pet = self.store.pets_mut().entry(id).or_default();
            let now = souls.get(&id).copied().unwrap_or(0);
            if pet.souls != now && (pet.souls > 0 || name.is_some()) {
                corrected.push(json!({ "id": id, "name": name, "before": pet.souls, "after": now }));
            }
            pet.souls = now;
            if let Some(&level) = levels.get(&id) {
                pet.level = Some(level);
                pet.level_estimated = false;
            }
        }
        self.save();
        tracing::info!("login sync: {} pets, {} souls", souls.len(), souls.values().sum::<u32>());
        (self.emit)(json!({
            "type": "sync", "ts": ts, "pets": souls.len(), "souls": souls.values().sum::<u32>(),
            "corrected": corrected, "collection": self.snapshot(),
        }));
    }

    fn souls(&mut self, ts: i64, list: &[(u32, u32)]) {
        // The kill just before (its credit comes ~0.3 s before the souls) names
        // the pet's monster; only when the souls are one pet's, so two pets
        // never take each other's monster.
        let kill = self.recent.iter().filter(|(t, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).max_by_key(|(t, _)| *t);
        let kill_name = match (list.len(), kill) {
            (1, Some((_, mob))) => self.mob_code.get(mob).and_then(|code| self.npc_name(*code)),
            _ => None,
        };
        // Whoever was credited with the kill just before is (most often) you.
        let credited = self.credits.iter().filter(|(t, _, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).max_by_key(|(t, _, _)| *t);
        if let Some((_, _, owner)) = credited {
            *self.self_votes.entry(*owner).or_default() += 1;
        }
        let name = self.store.current.clone().unwrap_or_default();
        for &(id, amount) in list {
            let pet = self.store.pets_mut().entry(id).or_default();
            pet.souls += amount;
            // Past its level's need the pet goes up a level and its count starts
            // again from 0, as the game's does (extra souls are not carried over).
            let level = match pet.level {
                Some(level) => level,
                None => {
                    pet.level_estimated = true;
                    0
                }
            };
            let levelled = level < MAX_LEVEL && pet.souls >= LEVEL_NEED[level as usize];
            pet.level = Some(if levelled { level + 1 } else { level });
            if levelled {
                pet.souls = 0;
            }
            if let Some(kill_name) = &kill_name {
                self.store.vote(id, kill_name, 1);
            }
            *self.sessions.entry(name.clone()).or_default().entry(id).or_default() += amount;
            (self.emit)(json!({ "type": "soul", "ts": ts, "amount": amount, "pet": self.view(id), "levelUp": levelled }));
        }
        self.save();
    }

    /// The game says a pet reached a level. Already there from its souls: the
    /// souls picked up since stay. Behind: it takes the level, from 0 souls.
    fn level_up(&mut self, id: u32, level: u32) {
        let pet = self.store.pets_mut().entry(id).or_default();
        if pet.level.unwrap_or(0) >= level {
            pet.level_estimated = false;
            return;
        }
        pet.level = Some(level);
        pet.level_estimated = false;
        pet.souls = 0;
        self.save();
        tracing::info!("level up: pet {id} is Lv{level} (from the game)");
        (self.emit)(json!({ "type": "pet", "pet": self.view(id) }));
    }

    fn maxed(&self, id: u32) -> bool {
        self.store.pets().and_then(|p| p.get(&id)).and_then(|p| p.level).unwrap_or(0) >= MAX_LEVEL
    }

    /// Genus crystals, from a monster whose pet is maxed. The message names no
    /// pet, so it is the pet of a monster killed just before (yours if it is
    /// known which player you are), of the crystal's genus. Among those:
    /// - a pet already at Lv3 is it: the nearest such kill;
    /// - else, if they are all one pet's monsters, that pet is at Lv3 in game
    ///   whatever was saved (souls missed): it is corrected and credited;
    /// - else no one: two pets that could both be it.
    fn crystal(&mut self, ts: i64, crystal: &p::Crystal) {
        let genus = p::crystal_genus(crystal.genus);
        let credited: Vec<(i64, u32, u32)> =
            self.credits.iter().filter(|(t, _, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).map(|&(t, m, o)| (ts - t, m, o)).collect();
        let me = self.me();
        let mine: Vec<_> = credited.iter().filter(|c| Some(c.2) == me).copied().collect();
        let kills = if mine.is_empty() { credited } else { mine };
        // (ms before, monster code, pet) for each kill whose monster drops a pet of this genus.
        let mut candidates: Vec<(i64, u32, u32)> = kills
            .iter()
            .filter_map(|&(ago, mob, _)| {
                let code = *self.mob_code.get(&mob)?;
                let pet = *self.pets.droppers.get(&code)?;
                let pet_genus = self.pets.genus.get(&pet).map(String::as_str);
                (genus.is_none() || pet_genus.is_none() || pet_genus == genus).then_some((ago, code, pet))
            })
            .collect();
        candidates.sort();
        let maxed: Vec<_> = candidates.iter().filter(|c| self.maxed(c.2)).copied().collect();
        let (pick, corrected) = if let Some(&first) = maxed.first() {
            (Some(first), false)
        } else if !candidates.is_empty() && candidates.iter().all(|c| c.2 == candidates[0].2) {
            (Some(candidates[0]), true)
        } else {
            (None, false)
        };
        let raw = crystal.raw.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ");
        let mut event = json!({
            "type": "crystal", "ts": ts, "amount": crystal.amount, "genus": genus,
            "npc": pick.map(|p| p.1), "raw": raw, "pet": null, "levelCorrected": false, "kills": [],
        });
        match pick {
            Some((_, code, id)) => {
                let name = self.npc_name(code);
                let pet = self.store.pets_mut().entry(id).or_default();
                if corrected {
                    pet.level = Some(MAX_LEVEL);
                    pet.souls = 0;
                    pet.level_estimated = false;
                    event["levelCorrected"] = json!(true);
                }
                pet.crystals += crystal.amount;
                if let Some(name) = name {
                    self.store.vote(id, &name, 1);
                }
                self.save();
                event["pet"] = self.view(id);
            }
            None => {
                // What was considered, to see in the log why it went to no one.
                event["kills"] = Value::Array(
                    kills
                        .iter()
                        .map(|&(ago, mob, _)| {
                            let code = self.mob_code.get(&mob).copied();
                            json!({
                                "npc": code, "name": code.and_then(|c| self.npc_name(c)),
                                "pet": code.and_then(|c| self.pets.droppers.get(&c)), "ago": ago as f64 / 1000.0,
                            })
                        })
                        .collect(),
                );
            }
        }
        (self.emit)(event);
    }

    /// Your legion, kept with the character playing (the kill feed's "my legion").
    fn my_legion(&mut self, name: &str) {
        let Some(me) = self.store.current.clone() else { return };
        let entry = self.store.characters.entry(me).or_default();
        if entry.legion.as_deref() != Some(name) {
            entry.legion = Some(name.to_string());
            self.save();
        }
    }

    /// A player killed a player around you (the killing blow): passed on once,
    /// with the victim if they were in view, and whether it was you or your legion.
    fn pvp_kill(&mut self, ts: i64, credit: &p::KillCredit) {
        let key = (credit.victim, credit.killer);
        if self.pvp_seen.get(&key).is_some_and(|&at| ts - at < PVP_REPEAT_MS) {
            return;
        }
        self.pvp_seen.retain(|_, at| ts - *at < 2 * PVP_REPEAT_MS);
        self.pvp_seen.insert(key, ts);
        let me = self.store.current.clone();
        let mine_entry = me.as_ref().and_then(|m| self.store.characters.get(m)).cloned().unwrap_or_default();
        if me.as_deref() == Some(credit.name.as_str()) {
            if let Some(legion) = &credit.legion {
                self.my_legion(legion);
            }
        }
        let my_legion = me.as_ref().and_then(|m| self.store.characters.get(m)?.legion.clone());
        let died = self.self_entity.is_some() && Some(credit.victim) == self.self_entity;
        let victim = if died {
            Some(json!({ "name": me, "server": mine_entry.server, "guild": my_legion }))
        } else {
            self.players.get(&credit.victim).map(|v| {
                json!({ "name": v.name, "server": v.server, "guild": v.legion.clone().or_else(|| self.legions.get(&credit.victim).cloned()) })
            })
        };
        let killer_legion = credit.legion.clone().or_else(|| self.legions.get(&credit.killer).cloned());
        // Legion names are per server: one of the same name elsewhere is another legion.
        let ours = |legion: Option<&str>, server: Option<u64>| {
            my_legion.is_some()
                && legion == my_legion.as_deref()
                && (server.is_none() || mine_entry.server.is_none() || server == mine_entry.server.map(u64::from))
        };
        let legion = ours(killer_legion.as_deref(), Some(credit.server as u64))
            || victim.as_ref().is_some_and(|v| ours(v["guild"].as_str(), v["server"].as_u64()));
        (self.emit)(json!({
            "type": "pvpKill", "ts": ts,
            "killer": { "name": credit.name, "server": credit.server, "guild": killer_legion },
            "victim": victim,
            "mine": me.as_deref() == Some(credit.name.as_str())
                && mine_entry.server.is_none_or(|s| s == credit.server),
            "died": died,
            "legion": legion,
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(op: [u8; 2], body: &[u8]) -> Vec<u8> {
        let mut out = vec![(body.len() + 6) as u8];
        out.extend_from_slice(&op);
        out.extend_from_slice(body);
        out
    }

    fn le(parts: &[u32]) -> Vec<u8> {
        parts.iter().flat_map(|p| p.to_le_bytes()).collect()
    }

    fn soul(pets: &[(u32, u32)]) -> Vec<u8> {
        let mut body = vec![pets.len() as u8];
        for &(pet, n) in pets {
            body.extend(le(&[pet, n]));
        }
        frame(p::OP_SOUL, &body)
    }

    fn character(entity: u8, name: &str, server: u16) -> Vec<u8> {
        let mut body = vec![entity, 0, 0, 0, 0, 0, name.len() as u8];
        body.extend(name.as_bytes());
        body.extend(server.to_le_bytes());
        frame(p::OP_SELF, &body)
    }

    fn collection(pets: &[(u32, u32, u32)]) -> Vec<u8> {
        let mut body = vec![0, 0, 0, 0, pets.len() as u8];
        for &(pet, level, _) in pets {
            body.extend(le(&[pet, pet, level]));
        }
        body.push(pets.len() as u8);
        for &(pet, _, souls) in pets {
            body.extend(le(&[pet, souls]));
        }
        frame(p::OP_COLLECTION, &body)
    }

    fn tracker() -> (Tracker, Arc<std::sync::Mutex<Vec<Value>>>) {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let t = Tracker::new(
            Store::default(),
            None,
            Arc::new(NpcLookup::new()),
            Arc::new(DataStorage::new()),
            Box::new(move |ev| sink.lock().unwrap().push(ev)),
        );
        (t, events)
    }

    fn pet(t: &Tracker, id: u32) -> Pet {
        t.store.pets().and_then(|p| p.get(&id)).cloned().unwrap_or_default()
    }

    #[test]
    fn a_pickup_for_two_pets_counts_both_and_a_level_up_starts_from_zero() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(2000, &collection(&[(1006, 0, 4), (1015, 1, 24)]));
        t.frame(2100, &character(5, "Ksix", 1104));
        // 4/5 and 24/25: one more each levels both, and 2 for 1015 is not carried over.
        t.frame(3000, &soul(&[(1006, 1), (1015, 2)]));
        assert_eq!((pet(&t, 1006).level, pet(&t, 1006).souls), (Some(1), 0));
        assert_eq!((pet(&t, 1015).level, pet(&t, 1015).souls), (Some(2), 0));
        let souls: Vec<_> = events.lock().unwrap().iter().filter(|e| e["type"] == "soul").cloned().collect();
        assert_eq!(souls.len(), 2);
        assert!(souls.iter().all(|s| s["levelUp"] == true));
        assert_eq!(souls[1]["pet"]["session"], 2);
    }

    #[test]
    fn the_games_level_up_is_taken_when_the_count_missed_it() {
        let (mut t, events) = tracker();
        t.frame(1000, &soul(&[(1006, 3)]));
        assert_eq!((pet(&t, 1006).level, pet(&t, 1006).level_estimated), (Some(0), true));
        // The game says Lv2: souls were missed.
        t.frame(2000, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[1006, 2])].concat()));
        let now = pet(&t, 1006);
        assert_eq!((now.level, now.souls, now.level_estimated), (Some(2), 0, false));
        assert!(events.lock().unwrap().iter().any(|e| e["type"] == "pet"));
        // Already there from its souls: nothing changes.
        t.frame(3000, &soul(&[(1006, 1)]));
        t.frame(3100, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[1006, 2])].concat()));
        assert_eq!(pet(&t, 1006).souls, 1);
    }

    #[test]
    fn each_server_has_its_own_collection_and_the_login_sync_goes_to_the_one_entering() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(1100, &collection(&[(1006, 1, 10)]));
        t.frame(1200, &character(5, "Ksix", 1104));
        // An alt on the same server: the same collection.
        t.frame(5000, &collection(&[(1006, 1, 11)]));
        t.frame(5100, &character(6, "Alt", 1104));
        assert_eq!(t.store.key(), "1104");
        assert_eq!(pet(&t, 1006).souls, 11);
        // A character on another server: its own, and the sync before its record is its.
        t.frame(9000, &collection(&[(1006, 0, 2)]));
        t.frame(9100, &character(7, "Other", 2104));
        assert_eq!(t.store.key(), "2104");
        assert_eq!(pet(&t, 1006).souls, 2);
        assert_eq!(t.store.servers["1104"].pets[&1006].souls, 11, "the first server's is untouched");
        let evs = events.lock().unwrap();
        let syncs = evs.iter().filter(|e| e["type"] == "sync").count();
        let characters: Vec<_> = evs.iter().filter(|e| e["type"] == "character").map(|e| e["name"].clone()).collect();
        assert_eq!(syncs, 3);
        assert_eq!(characters, vec![json!("Ksix"), json!("Alt"), json!("Other")]);
    }

    fn effect(target: u8, x: f32, y: f32) -> Vec<u8> {
        let mut body = vec![7, 0x11];
        body.extend(1_792_350_000_000u64.to_le_bytes());
        body.extend([target, 0x01, 0x00]);
        for v in [x, y, 15_000.0f32] {
            body.extend(v.to_le_bytes());
        }
        frame(p::OP_EFFECTS[0], &body)
    }

    #[test]
    fn effects_on_you_say_where_you_are_and_a_misread_jump_does_not() {
        let (mut t, _) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        // Someone else's effect: not you.
        t.frame(1100, &effect(9, 5000.0, 6000.0));
        assert_eq!(t.position, None);
        t.frame(1200, &effect(5, 5000.0, 6000.0));
        assert_eq!(t.position, Some((5000.0, -6000.0)));
        // 50,000 away 0.1 s later: no one moves that fast.
        t.frame(1300, &effect(5, 55_000.0, 6000.0));
        assert_eq!(t.position, Some((5000.0, -6000.0)));
        // 300 away a second later: walking.
        t.frame(2200, &effect(5, 5300.0, 6000.0));
        assert_eq!(t.position, Some((5300.0, -6000.0)));
        assert!(t.nearby_dirty);
    }

    #[test]
    fn a_cube_in_view_is_reported_until_it_is_opened() {
        let (mut t, events) = tracker();
        let mut cube = vec![0xe5, 0xff, 0x03, 0x04, 0x00];
        cube.extend(1_200_039u32.to_le_bytes());
        for v in [-50205.0f32, 126283.0, 15449.0, 0.0, 0.0] {
            cube.extend(v.to_le_bytes());
        }
        cube.extend([1, 1, 1]);
        cube.extend(1_792_350_000_000u64.to_le_bytes());
        t.frame(1000, &frame(p::OP_OBJECT_SPAWN, &cube));
        // Another object (a gathering spot): not a cube.
        let mut other = cube.clone();
        other[5..9].copy_from_slice(&1_500_041u32.to_le_bytes());
        other[0] = 0x10;
        t.frame(1100, &frame(p::OP_OBJECT_SPAWN, &other));
        let shown = t.cubes();
        assert_eq!(shown.as_array().unwrap().len(), 1);
        assert_eq!(shown[0]["position"], json!([-50205, -126283]));
        t.frame(2000, &frame(p::OP_OBJECT_REMOVED, &[0xe5, 0xff, 0x03, 0x04, 0x03, 0x00]));
        assert!(t.cubes().as_array().unwrap().is_empty());
        let reported = events.lock().unwrap().iter().filter(|e| e["type"] == "cubes").count();
        assert_eq!(reported, 2, "once in view, once opened");
    }

    #[test]
    fn a_sync_with_no_character_record_after_it_goes_to_the_one_playing() {
        let (mut t, _) = tracker();
        t.frame(1000, &collection(&[(1006, 1, 7)]));
        assert_eq!(pet(&t, 1006).souls, 0, "waiting for the character record");
        t.frame(1000 + SYNC_WAIT_MS + 1, &frame([0x99, 0x99], &[]));
        assert_eq!(pet(&t, 1006).souls, 7);
    }
}
