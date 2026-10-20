//! The pet tables the tracker needs, from the app's own copies (questlog.gg's
//! data, built into the engine so there is one source): which ids are pets,
//! each pet's genus, and which pet each monster drops souls of.

use std::collections::HashMap;
use std::sync::OnceLock;

const PETS: &str = include_str!("../../../app/src/renderer/src/data/pets.json");
const SPAWNS: &str = include_str!("../../../app/src/renderer/public/maps/spawns.json");

pub struct PetData {
    /// pet -> genus ("fera", "cogni", "natura", "varian", "special")
    pub genus: HashMap<u32, String>,
    /// monster code -> the pet whose souls it drops (each monster drops one)
    pub droppers: HashMap<u32, u32>,
}

impl PetData {
    pub fn is_pet(&self, id: u32) -> bool {
        self.genus.contains_key(&id)
    }
}

pub fn pets() -> &'static PetData {
    static DATA: OnceLock<PetData> = OnceLock::new();
    DATA.get_or_init(|| {
        let pets: serde_json::Value = serde_json::from_str(PETS).unwrap_or_default();
        let genus = pets["pets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| Some((p["id"].as_u64()? as u32, p["genus"].as_str().unwrap_or_default().to_string())))
            .collect();
        let spawns: serde_json::Value = serde_json::from_str(SPAWNS).unwrap_or_default();
        let droppers = spawns["pets"]
            .as_object()
            .into_iter()
            .flatten()
            .flat_map(|(pet, list)| {
                let pet: u32 = pet.parse().unwrap_or_default();
                list.as_array().into_iter().flatten().filter_map(move |d| Some((d["npc"].as_u64()? as u32, pet)))
            })
            .collect();
        PetData { genus, droppers }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_tables_load() {
        let data = super::pets();
        assert!(data.genus.len() > 200, "{}", data.genus.len());
        assert!(data.is_pet(1006) && !data.is_pet(77298));
        // Krall Armed Soldier drops Pet 1002's souls.
        assert_eq!(data.droppers.get(&2100075), Some(&1002));
    }
}
