//! The saved collection (`collection.json`, in the app's data folder).
//!
//! Version 2 keeps one collection per game server: a server's characters
//! share it, as the game does. The monster names learned for each pet are kept
//! once, for all.
//!
//! ```json
//! { "version": 2,
//!   "current": "Ksix",
//!   "characters": { "Ksix": { "server": 1104, "legion": "Lokthar" } },
//!   "servers": { "1104": { "pets": { "1006": { "souls": 3, "level": 1, "crystals": 0 } } } },
//!   "names": { "1006": { "Meadow Sparkie": 5 } } }
//! ```
//!
//! Version 1 (the Python tracker's) kept a collection per character: it is
//! read once and moved across (`migrate`), leaving out anything that is not a
//! pet (the misreads that showed as "Pet #77298" with billions of souls). The
//! old file is kept as `collection.v1.json`.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::data::PetData;

/// The collection of a character whose server is not known yet.
pub const UNKNOWN_SERVER: &str = "unknown";
/// Souls to go from Lv0 to 1, 1 to 2 and 2 to 3; at Lv3 genus crystals take over.
pub const LEVEL_NEED: [u32; 3] = [5, 25, 75];
pub const MAX_LEVEL: u32 = 3;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Pet {
    pub souls: u32,
    /// None: the server never said (a pet seen only from its souls).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u32>,
    /// The level was worked out from the souls, not sent by the server.
    #[serde(default, rename = "levelEstimated", skip_serializing_if = "std::ops::Not::not")]
    pub level_estimated: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub crystals: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Character {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legion: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Collection {
    pub pets: BTreeMap<u32, Pet>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Store {
    pub version: u32,
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub characters: BTreeMap<String, Character>,
    #[serde(default)]
    pub servers: BTreeMap<String, Collection>,
    /// pet -> monster name -> votes
    #[serde(default)]
    pub names: BTreeMap<u32, BTreeMap<String, u32>>,
}

impl Default for Store {
    fn default() -> Self {
        Self { version: 2, current: None, characters: BTreeMap::new(), servers: BTreeMap::new(), names: BTreeMap::new() }
    }
}

impl Store {
    /// The saved collection, or an empty one when there is none. A file that
    /// will not read is an error: starting empty would overwrite it.
    pub fn load(path: &Path, pets: &PetData) -> Result<Self, String> {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let value: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut store = if value["version"].as_u64() == Some(2) {
            serde_json::from_value(value).map_err(|e| format!("{}: {e}", path.display()))?
        } else {
            // The Python tracker's file is kept as it was, beside the new one.
            let backup = path.with_extension("v1.json");
            if !backup.exists() {
                std::fs::copy(path, &backup).map_err(|e| format!("{}: {e}", backup.display()))?;
            }
            migrate(&value)
        };
        store.clean(pets);
        Ok(store)
    }

    /// Written whole to a temporary file, then moved over the old one.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let tmp = path.with_extension("tmp");
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// The collection's key: the server of the character playing.
    pub fn key(&self) -> String {
        self.current
            .as_ref()
            .and_then(|name| self.characters.get(name)?.server)
            .map_or_else(|| UNKNOWN_SERVER.to_string(), |s| s.to_string())
    }

    pub fn pets(&self) -> Option<&BTreeMap<u32, Pet>> {
        self.servers.get(&self.key()).map(|c| &c.pets)
    }

    pub fn pets_mut(&mut self) -> &mut BTreeMap<u32, Pet> {
        let key = self.key();
        &mut self.servers.entry(key).or_default().pets
    }

    /// The monster name with the most votes for a pet.
    pub fn name(&self, pet: u32) -> Option<&str> {
        let votes = self.names.get(&pet)?;
        votes.iter().max_by_key(|(name, n)| (**n, std::cmp::Reverse(*name))).map(|(name, _)| name.as_str())
    }

    pub fn vote(&mut self, pet: u32, name: &str, votes: u32) {
        *self.names.entry(pet).or_default().entry(name.to_string()).or_default() += votes;
    }

    /// The collection of a character whose server was not known, now that it
    /// is: moved to that server unless the server has one already.
    pub fn adopt_unknown(&mut self) {
        let key = self.key();
        if key == UNKNOWN_SERVER {
            return;
        }
        if let Some(unknown) = self.servers.remove(UNKNOWN_SERVER) {
            self.servers.entry(key).or_insert(unknown);
        }
    }

    /// Leave out what is not a pet, and level up counts saved past their
    /// level's need (the souls past each step count toward the next).
    fn clean(&mut self, pets: &PetData) {
        for collection in self.servers.values_mut() {
            collection.pets.retain(|id, pet| pets.is_pet(*id) && pet.souls < 1000);
            for pet in collection.pets.values_mut() {
                let Some(mut level) = pet.level else { continue };
                while level < MAX_LEVEL && pet.souls >= LEVEL_NEED[level as usize] {
                    pet.souls -= LEVEL_NEED[level as usize];
                    level += 1;
                }
                pet.level = Some(level);
            }
        }
        self.names.retain(|id, _| pets.is_pet(*id));
    }
}

/// Version 1: `{"pets": {...}, "current": name, "characters": {name: {"server", "pets"?}}}`,
/// each pet `{"souls", "votes": {name: n}, "level"?, "levelEstimated"?, "crystals"?}`.
/// The current character's collection goes to its server; another character's
/// to its server when that has none yet. Every character's votes are kept.
fn migrate(v1: &Value) -> Store {
    let mut store = Store::default();
    let current = v1["current"].as_str().map(str::to_string);
    let server_of = |name: &str| v1["characters"][name]["server"].as_u64().map(|s| s as u16);
    for (name, entry) in v1["characters"].as_object().into_iter().flatten() {
        store.characters.insert(name.clone(), Character { server: server_of(name), legion: entry["guild"].as_str().map(str::to_string) });
    }
    let key = |name: Option<&str>| name.and_then(server_of).map_or_else(|| UNKNOWN_SERVER.to_string(), |s| s.to_string());
    let mut take = |key: String, pets: &Value| {
        let mut collection = Collection::default();
        for (id, pet) in pets.as_object().into_iter().flatten() {
            let Ok(id) = id.parse::<u32>() else { continue };
            for (name, n) in pet["votes"].as_object().into_iter().flatten() {
                let votes = store.names.entry(id).or_default().entry(name.clone()).or_default();
                *votes = (*votes).max(n.as_u64().unwrap_or_default() as u32);
            }
            collection.pets.insert(
                id,
                Pet {
                    souls: pet["souls"].as_u64().unwrap_or_default().min(u32::MAX as u64) as u32,
                    level: pet["level"].as_u64().map(|l| l as u32),
                    level_estimated: pet["levelEstimated"].as_bool().unwrap_or(false),
                    crystals: pet["crystals"].as_u64().unwrap_or_default() as u32,
                },
            );
        }
        store.servers.entry(key).or_insert(collection);
    };
    take(key(current.as_deref()), &v1["pets"]);
    for (name, entry) in v1["characters"].as_object().into_iter().flatten() {
        if Some(name) != current.as_ref() && entry.get("pets").is_some() {
            take(key(Some(name)), &entry["pets"]);
        }
    }
    store.current = current;
    store
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pets() -> &'static PetData {
        super::super::data::pets()
    }

    #[test]
    fn a_python_collection_moves_to_its_server_without_the_misreads() {
        let v1 = json!({
            "current": "Ksix",
            "pets": {
                "1006": {"souls": 3, "votes": {"Meadow Sparkie": 4}, "level": 1},
                "77298": {"souls": 3845597724u64, "votes": {}},
                "1015": {"souls": 97, "votes": {}, "level": 1}
            },
            "characters": {
                "Ksix": {"server": 1104, "guild": "Lokthar"},
                "Alt": {"server": 2104, "pets": {"1006": {"souls": 1, "votes": {"Meadow Sparkie": 9}}}}
            }
        });
        let dir = std::env::temp_dir().join(format!("lokthar-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("collection.json");
        std::fs::write(&path, v1.to_string()).unwrap();
        let store = Store::load(&path, pets()).unwrap();
        let ksix = &store.servers["1104"].pets;
        assert_eq!(ksix.keys().copied().collect::<Vec<_>>(), vec![1006, 1015], "no Pet #77298");
        // 97 souls at Lv1 was past its 25: Lv2 with the 72 left.
        assert_eq!((ksix[&1015].level, ksix[&1015].souls), (Some(2), 72));
        assert_eq!(store.servers["2104"].pets[&1006].souls, 1);
        assert_eq!(store.name(1006), Some("Meadow Sparkie"));
        assert_eq!(store.names[&1006]["Meadow Sparkie"], 9, "the most votes any character had");
        assert_eq!(store.characters["Ksix"].legion.as_deref(), Some("Lokthar"));
        assert_eq!(store.key(), "1104");
        store.save(&path).unwrap();
        assert_eq!(Store::load(&path, pets()).unwrap(), store, "version 2 reads back the same");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
