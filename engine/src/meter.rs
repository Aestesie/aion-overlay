//! The parser's shared state and the DPS meter on top of it.

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use a2tools_dps_meter_lib::capture::abnormal;
use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::combat::dps_calculator::DpsCalculator;
use a2tools_dps_meter_lib::combat::ping_tracker::PingTracker;
use a2tools_dps_meter_lib::i18n::lookup::{NpcLookup, SkillLookup};
use parking_lot::Mutex;

use crate::capture::combat_port_detector::CombatPortDetector;
use crate::capture::dispatcher::CaptureDispatcher;
use crate::history::FightHistoryManager;

// A2Tools DPS Meter's tables (src/data at the pinned rev), English only.
const NPCS: &str = include_str!("../data/npcs_en.json");
const SKILLS: &str = include_str!("../data/skills_en.json");
const DOT_SKILL_IDS: &str = include_str!("../data/dot_skill_ids.json");
const ABNORMALS: &str = include_str!("../data/abnormals.json");

/// Target modes the calculator knows, by the id the app sends.
pub const TARGET_MODES: &[&str] = &["bossTargets", "mostDamage", "mostRecent", "lastHitByMe", "allTargets", "trainTargets"];

pub struct Meter {
    pub storage: Arc<DataStorage>,
    pub port_detector: Arc<CombatPortDetector>,
    pub calculator: Mutex<DpsCalculator>,
    skills: Arc<SkillLookup>,
    pub npcs: Arc<NpcLookup>,
    pub ping: Arc<PingTracker>,
    dot_skill_ids: HashSet<i32>,
    /// Where boss fights are saved; none in a replay.
    pub history: OnceLock<FightHistoryManager>,
}

impl Meter {
    pub fn new() -> Self {
        let skills = SkillLookup::new();
        skills.load_from_json(SKILLS);
        let npcs = NpcLookup::new();
        npcs.load_from_json(NPCS);
        let (skills, npcs) = (Arc::new(skills), Arc::new(npcs));
        let storage = Arc::new(DataStorage::new());
        storage.set_abnormal_stack_limits(abnormal::stack_limits(ABNORMALS));
        let ping = Arc::new(PingTracker::new());
        let calculator = DpsCalculator::new(storage.clone(), skills.clone(), npcs.clone(), ping.clone());
        let dot_skill_ids = serde_json::from_str::<Vec<i32>>(DOT_SKILL_IDS).unwrap_or_default().into_iter().collect();
        Self {
            storage,
            port_detector: Arc::new(CombatPortDetector::new()),
            calculator: Mutex::new(calculator),
            skills,
            npcs,
            ping,
            dot_skill_ids,
            history: OnceLock::new(),
        }
    }

    /// Save the boss fights (and training dummy sessions) on the meter to the
    /// history: those changed since their last save, or every one with
    /// `force` (before the combat data is cleared). How many were saved.
    pub fn save_fights(&self, force: bool) -> usize {
        let Some(history) = self.history.get() else { return 0 };
        if self.storage.damage_generation() <= 0 {
            return 0;
        }
        let records = {
            let mut calculator = self.calculator.lock();
            if force { calculator.snapshot_boss_fights_force() } else { calculator.snapshot_boss_fights() }
        };
        records.iter().filter(|r| history.save_fight(r).map_err(|e| tracing::warn!("fight not saved: {e}")).is_ok()).count()
    }

    /// A dispatcher feeding this meter's parser.
    pub fn dispatcher(&self) -> CaptureDispatcher {
        let mut dispatcher = CaptureDispatcher::new(
            self.storage.clone(),
            self.skills.clone(),
            self.npcs.clone(),
            self.port_detector.clone(),
            self.ping.clone(),
        );
        dispatcher.set_dot_skill_ids(self.dot_skill_ids.clone());
        dispatcher
    }

    /// The meter as the app shows it, as JSON (`DpsData`, camelCase).
    pub fn dps(&self) -> serde_json::Value {
        serde_json::to_value(self.calculator.lock().get_dps()).unwrap_or_default()
    }

    /// One target's breakdown by skill, for the given players (all when none).
    pub fn details(&self, target: i32, actors: Option<&[i32]>) -> serde_json::Value {
        serde_json::to_value(self.calculator.lock().get_target_details(target, actors)).unwrap_or_default()
    }

    /// The buffs and debuffs of the live fight on `target` so far (upstream's
    /// `get_fight_buffs`), as JSON: `{"startTimeMs", "durationMs", "buffs": [BuffTrack]}`.
    pub fn fight_buffs(&self, target: i32) -> serde_json::Value {
        serde_json::to_value(self.calculator.lock().live_fight_buffs(target)).unwrap_or_default()
    }

    /// What is on your character now, one entry per buff (its stacks counted):
    /// `[{"id", "stacks", "endsAt": ms | null, "startedAt", "by", "skill", "mine", "debuff"}]`, the
    /// game's ids (`SkillAbnormal`). A debuff is one cast by someone who is not a
    /// player (a monster); players' are buffs, yours or your party's.
    pub fn my_buffs(&self) -> serde_json::Value {
        let Some(me) = self.storage.local_player_id().and_then(|id| i32::try_from(id).ok()) else {
            return serde_json::json!([]);
        };
        let now = a2tools_dps_meter_lib::clock::now_ms();
        let players = self.storage.get_nicknames();
        let mut by_id: std::collections::BTreeMap<(u32, i32), serde_json::Value> = std::collections::BTreeMap::new();
        for i in self.storage.abnormal_instances(now, now).into_iter().filter(|i| i.entity == me && i.end_ms.is_none()) {
            // Ran out on the server's clock and nothing said so yet.
            if i.server_end_ms.is_some_and(|e| e < now - 1_000) {
                continue;
            }
            let entry = by_id.entry((i.abnormal, i.caster)).or_insert_with(|| {
                serde_json::json!({
                    "id": i.abnormal, "stacks": 0, "endsAt": i.server_end_ms, "startedAt": i.start_ms,
                    "by": i.caster, "skill": i.skill, "mine": i.caster == me,
                    "debuff": i.caster != me && i.caster != 0 && !players.contains_key(&i.caster),
                    "passive": i.endless,
                })
            });
            entry["stacks"] = serde_json::json!(entry["stacks"].as_u64().unwrap_or(0) + 1);
            // The stack that runs longest says when it ends.
            if let (Some(end), Some(prev)) = (i.server_end_ms, entry["endsAt"].as_i64())
                && end > prev
            {
                entry["endsAt"] = serde_json::json!(end);
            }
        }
        serde_json::Value::Array(by_id.into_values().collect())
    }

    pub fn set_target_mode(&self, mode: &str) -> bool {
        if !TARGET_MODES.contains(&mode) {
            return false;
        }
        self.calculator.lock().set_target_selection_mode(mode);
        true
    }

    /// Start over: no target, no damage. The fights on the meter are saved first.
    pub fn reset(&self) {
        self.save_fights(true);
        self.calculator.lock().restart_target_selection(true);
    }
}
