//! The parser's shared state and the DPS meter on top of it.

use std::collections::HashSet;
use std::sync::Arc;

use a2tools_dps_meter_lib::capture::abnormal;
use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::combat::dps_calculator::DpsCalculator;
use a2tools_dps_meter_lib::combat::ping_tracker::PingTracker;
use a2tools_dps_meter_lib::i18n::lookup::{NpcLookup, SkillLookup};
use parking_lot::Mutex;

use crate::capture::combat_port_detector::CombatPortDetector;
use crate::capture::dispatcher::CaptureDispatcher;

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
    ping: Arc<PingTracker>,
    dot_skill_ids: HashSet<i32>,
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
        }
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

    pub fn set_target_mode(&self, mode: &str) -> bool {
        if !TARGET_MODES.contains(&mode) {
            return false;
        }
        self.calculator.lock().set_target_selection_mode(mode);
        true
    }

    /// Start over: no target, no damage.
    pub fn reset(&self) {
        self.calculator.lock().restart_target_selection(true);
    }
}
