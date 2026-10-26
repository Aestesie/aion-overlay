//! PvP fights: every hit between you and another player (read by `damage`, a
//! copy of A2Tools DPS Meter's reader: its meter takes a player's hit on a
//! player for party healing and keeps none), and on a kill or a death of
//! yours, the fight with that player saved: each side's skills, the damage they
//! did and when. The PvP page opens one in the Details window.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Hits kept: the last few minutes of fighting, whatever comes of it.
const KEEP_MS: i64 = 10 * 60_000;
const MAX_HITS: usize = 20_000;
/// A pause this long between two players' hits ends one fight: the hits before it are another.
pub const GAP_MS: i64 = 30_000;
/// Fights kept on disk, newest first.
const MAX_FIGHTS: usize = 300;

/// One hit between you and another player, as the parser read it.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub ts: i64,
    pub actor: u32,
    pub target: u32,
    pub skill: i32,
    pub damage: i64,
    pub crit: bool,
    pub dot: bool,
    pub back: bool,
    pub perfect: bool,
    pub double: bool,
    pub parry: bool,
    pub multi: u32,
}

#[derive(Default)]
pub struct Hits {
    list: VecDeque<Hit>,
}

impl Hits {
    pub fn push(&mut self, hit: Hit) {
        let cutoff = hit.ts - KEEP_MS;
        while self.list.front().is_some_and(|h| h.ts < cutoff) || self.list.len() >= MAX_HITS {
            self.list.pop_front();
        }
        self.list.push_back(hit);
    }

    /// The hits between `a` and `b` (either way) of the fight that ended by `end`: back from the
    /// last one before it, to the first pause longer than `GAP_MS`.
    pub fn between(&self, a: u32, b: u32, end: i64) -> Vec<Hit> {
        let mut out: Vec<Hit> = Vec::new();
        for h in self.list.iter().rev() {
            if h.ts > end || !((h.actor == a && h.target == b) || (h.actor == b && h.target == a)) {
                continue;
            }
            if out.last().is_some_and(|later| later.ts - h.ts > GAP_MS) {
                break;
            }
            out.push(h.clone());
        }
        out.reverse();
        out
    }
}

/// One player's skill in a fight, in the Details window's terms (shared/meter.ts `DetailsSkill`,
/// but its name, which the sidecar adds from the skill list).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillLine {
    pub actor: u32,
    pub code: i32,
    pub damage: i64,
    pub hits: u32,
    pub crits: u32,
    pub max_hit: i64,
    pub dot: bool,
    pub back: u32,
    pub perfect: u32,
    pub double: u32,
    pub parry: u32,
    pub multi: u32,
    /// When each hit landed, ms from the fight's start.
    pub at: Vec<i64>,
}

/// One side of a fight.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub entity: u32,
    pub name: String,
    pub server: Option<u16>,
    pub class_name: Option<String>,
    pub combat_power: Option<u32>,
    pub legion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fight {
    pub id: String,
    /// When the kill came (ms since epoch).
    pub at: i64,
    /// "kill": you killed them; "death": they killed you.
    pub outcome: String,
    pub me: Side,
    pub opponent: Side,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub skills: Vec<SkillLine>,
}

/// The fight from its hits: each side's skills, most damage first.
pub fn fight(id: String, at: i64, outcome: &str, me: Side, opponent: Side, hits: &[Hit]) -> Fight {
    let start = hits.first().map_or(at, |h| h.ts);
    let end = hits.last().map_or(at, |h| h.ts);
    let mut lines: HashMap<(u32, i32), SkillLine> = HashMap::new();
    for h in hits {
        let line = lines.entry((h.actor, h.skill)).or_insert_with(|| SkillLine { actor: h.actor, code: h.skill, ..Default::default() });
        line.damage += h.damage;
        line.hits += 1;
        line.crits += u32::from(h.crit);
        line.max_hit = line.max_hit.max(h.damage);
        line.dot |= h.dot;
        line.back += u32::from(h.back);
        line.perfect += u32::from(h.perfect);
        line.double += u32::from(h.double);
        line.parry += u32::from(h.parry);
        line.multi += h.multi;
        line.at.push(h.ts - start);
    }
    let mut skills: Vec<SkillLine> = lines.into_values().collect();
    skills.sort_by(|a, b| b.damage.cmp(&a.damage));
    Fight { id, at, outcome: outcome.to_string(), me, opponent, start_ms: start, duration_ms: (end - start).max(1000), skills }
}

/// The fights saved, newest first.
pub struct Fights {
    path: Option<PathBuf>,
    list: Vec<Fight>,
}

impl Fights {
    pub fn load(path: Option<PathBuf>) -> Self {
        let list = path.as_ref().and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { path, list }
    }

    pub fn add(&mut self, fight: Fight) {
        self.list.insert(0, fight);
        self.list.truncate(MAX_FIGHTS);
        let Some(path) = &self.path else { return };
        let saved = serde_json::to_string(&self.list).map_err(|e| e.to_string()).and_then(|s| fs::write(path, s).map_err(|e| e.to_string()));
        if let Err(e) = saved {
            tracing::warn!("could not save the PvP fights: {e}");
        }
    }

    pub fn get(&self, id: &str) -> Option<&Fight> {
        self.list.iter().find(|f| f.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(ts: i64, actor: u32, target: u32, skill: i32, damage: i64) -> Hit {
        Hit { ts, actor, target, skill, damage, crit: damage > 1000, dot: false, back: false, perfect: false, double: false, parry: false, multi: 0 }
    }

    #[test]
    fn a_fight_is_the_hits_between_two_players_back_to_the_last_pause() {
        let mut hits = Hits::default();
        // An earlier fight with the same player, a minute before: not this one.
        hits.push(hit(0, 1, 2, 10, 500));
        hits.push(hit(60_000, 1, 2, 10, 800));
        hits.push(hit(61_000, 2, 1, 20, 1200));
        // Someone else's hit on you: not this fight's.
        hits.push(hit(61_500, 3, 1, 30, 999));
        hits.push(hit(62_000, 1, 2, 10, 900));
        let between = hits.between(1, 2, 63_000);
        assert_eq!(between.iter().map(|h| h.ts).collect::<Vec<_>>(), vec![60_000, 61_000, 62_000]);

        let f = fight("a".into(), 63_000, "kill", Side { entity: 1, ..Default::default() }, Side { entity: 2, ..Default::default() }, &between);
        assert_eq!((f.start_ms, f.duration_ms), (60_000, 2000));
        let mine = f.skills.iter().find(|s| s.actor == 1).unwrap();
        assert_eq!((mine.code, mine.damage, mine.hits, mine.max_hit, mine.at.clone()), (10, 1700, 2, 900, vec![0, 2000]));
        let theirs = f.skills.iter().find(|s| s.actor == 2).unwrap();
        assert_eq!((theirs.damage, theirs.crits), (1200, 1));
    }
}
