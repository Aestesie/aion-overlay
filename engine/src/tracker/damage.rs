//! Copied from A2Tools DPS Meter (GPL-3.0), https://github.com/taengu/A2Tools-DPS-Meter
//! src-tauri/src/capture/stream_processor.rs at 08b249d: `parsing_damage_inner`
//! and the helpers it calls (`try_read_varint`, `read_plotter`,
//! `parse_hit_tail`, `should_use_repeated_hit_damage`), cut down to what a PvP
//! fight needs.
//!
//! The meter reads every hit, but takes a player's hit on a player for party
//! healing and keeps none of them; the PvP fights (`pvp`) read the same `04 38`
//! records here. Left out from upstream: monsters' hits (7-digit NPC skills),
//! misses and resists, the embedded-record scan, the compact skill context
//! (a Spiritmaster spirit's aggregated record) and the trusted-shape check of
//! recovered records, none of which a hit between two players needs. Skill ids
//! are kept raw: the sidecar folds variants into their skill as upstream's
//! `normalize_skill_id` does, with the skill list (sidecar.rs, "pvpFight").

use a2tools_dps_meter_lib::capture::stream_processor::read_varint;
use a2tools_dps_meter_lib::entity::special_damage::{SpecialDamage, from_hit_flags};

pub const OP_DAMAGE: [u8; 2] = [0x04, 0x38];

/// One hit, as read.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub actor: u32,
    pub target: u32,
    pub skill: i32,
    pub damage: i64,
    pub crit: bool,
    pub specials: Vec<SpecialDamage>,
    pub multi_hit_count: i32,
}

fn try_read_varint(bytes: &[u8], offset: &mut usize) -> Option<i32> {
    let result = read_varint(bytes, *offset);
    if result.length <= 0 {
        return None;
    }
    *offset += result.length as usize;
    if result.value < 0 { None } else { Some(result.value) }
}

/// The hits in a `04 38` frame (one, or several chained by `01 00`). `plausible` is the parser's
/// entity id gate (`DataStorage::is_plausible_entity_id`).
pub fn hits(packet: &[u8], plausible: impl Fn(i32) -> bool) -> Vec<Hit> {
    let mut out = Vec::new();
    let length_info = read_varint(packet, 0);
    if length_info.length < 0 {
        return out;
    }
    let mut offset = length_info.length as usize;
    if offset + 1 >= packet.len() || packet[offset] != OP_DAMAGE[0] || packet[offset + 1] != OP_DAMAGE[1] {
        return out;
    }
    offset += 2;

    let mask = 0x0F;
    while offset < packet.len() {
        // Chained hit marker
        let mut is_chained = false;
        if offset + 1 < packet.len() && packet[offset] == 0x01 && packet[offset + 1] == 0x00 {
            offset += 2;
            is_chained = true;
        }
        if !out.is_empty() && !is_chained {
            break;
        }

        let Some(target_value) = try_read_varint(packet, &mut offset).filter(|&v| plausible(v)) else { break };
        let Some(switch_value) = try_read_varint(packet, &mut offset) else { break };
        let and_result = switch_value & mask;
        // Without bit 0x04 the record has no value: a miss or a resist.
        if !(4..=7).contains(&and_result) {
            break;
        }
        // Unused flag
        if try_read_varint(packet, &mut offset).is_none() {
            break;
        }
        let Some(actor_value) = try_read_varint(packet, &mut offset).filter(|&v| plausible(v)) else { break };

        // Exact 4-byte skill ID
        if offset + 4 > packet.len() {
            break;
        }
        let mut exact_skill_code = i64::from(u32::from_le_bytes([packet[offset], packet[offset + 1], packet[offset + 2], packet[offset + 3]]));
        offset += 4;
        // Theostone raw item IDs
        if (3_000_000..=3_099_999).contains(&exact_skill_code) {
            exact_skill_code = exact_skill_code * 10 + 1;
        }
        if !(1..=299_999_999).contains(&exact_skill_code) {
            break;
        }
        // A 7-digit skill is a monster's: not a hit between players.
        if (1_000_000..=9_999_999).contains(&exact_skill_code) {
            break;
        }

        // Skip 1-byte UID field
        if offset < packet.len() {
            offset += 1;
        }
        let Some(dummy_type) = try_read_varint(packet, &mut offset) else { break };
        let damage_type = dummy_type as u8;

        let temp_v: usize = match and_result {
            5 => 12,
            6 => 10,
            7 => 14,
            _ => 8,
        };
        // Switch bit 0x02: the damage plotter, `<flags byte> <restoration HP varint> <angle byte>`.
        let mut specials = Vec::new();
        let mut plotter_extra = 0;
        if and_result & 0x02 != 0 {
            let Some(flags) = packet.get(offset).copied() else { break };
            let mut at = offset + 1;
            if try_read_varint(packet, &mut at).is_none() {
                break;
            }
            let hp_len = at - offset - 1;
            specials = from_hit_flags(flags);
            match packet.get(at).copied() {
                Some(0x01) => specials.push(SpecialDamage::Back),
                Some(0x02) => specials.push(SpecialDamage::Frontal),
                _ => {}
            }
            plotter_extra = hp_len - 1;
        }
        if damage_type == 3 {
            specials.push(SpecialDamage::Critical);
        }

        offset += temp_v + plotter_extra;
        if offset >= packet.len() {
            break;
        }

        let Some(mut first_value) = try_read_varint(packet, &mut offset) else { break };
        let Some(mut second_value) = try_read_varint(packet, &mut offset) else { break };
        // A leading zero pad before the actor's power scalar: the value is one varint later.
        if first_value == 0 {
            if let Some(third) = try_read_varint(packet, &mut offset) {
                first_value = second_value;
                second_value = third;
            }
        }
        let _ = first_value;
        // The damage is always the second value, crits included.
        let mut final_damage = second_value;

        let strict_tail = if [4, 6].contains(&and_result) && exact_skill_code != 99_745_942 {
            parse_hit_tail(packet, offset, and_result, switch_value, final_damage)
        } else {
            None
        };

        // Multi-hit extra field
        if strict_tail.is_none() && (switch_value & 0x30) == 0x30 && offset < packet.len() {
            try_read_varint(packet, &mut offset);
        }

        let mut hit_count = 0;
        let pre_hit_offset = offset;
        let marker_at = |o: usize| o + 1 < packet.len() && packet[o + 1] == 0x00 && (1..=7).contains(&(packet[o] as i32));
        if strict_tail.is_none() && offset < packet.len() && !marker_at(offset) {
            if let Some(peek_val) = try_read_varint(packet, &mut offset) {
                if (0..=25).contains(&peek_val) {
                    hit_count = peek_val;
                } else if !marker_at(offset) {
                    if let Some(actual) = try_read_varint(packet, &mut offset) {
                        if (0..=25).contains(&actual) {
                            hit_count = actual;
                        } else {
                            offset = pre_hit_offset;
                        }
                    }
                }
            }
        }

        if !(0..=99_999_999).contains(&final_damage) {
            break;
        }

        // Extract multi-hits
        let mut multi_hit_count = 0;
        let mut multi_hit_damage = 0;
        let mut first_multi_hit_value: Option<i32> = None;
        let mut all_multi_hits_match = true;
        if strict_tail.is_none() && hit_count > 0 && offset < packet.len() {
            let safe_max = hit_count.min(25);
            let multi_hit_cap = final_damage.max(500_000);
            let mut hits_read = 0;
            while hits_read < safe_max && offset < packet.len() {
                let is_next_packet = offset + 1 < packet.len() && packet[offset] == 0x04 && packet[offset + 1] == 0x38;
                if marker_at(offset) || is_next_packet {
                    break;
                }
                let Some(hit_value) = try_read_varint(packet, &mut offset) else { break };
                if hit_value > multi_hit_cap || hit_value < 50 {
                    multi_hit_damage = 0;
                    first_multi_hit_value = None;
                    all_multi_hits_match = true;
                    break;
                }
                match first_multi_hit_value {
                    None => first_multi_hit_value = Some(hit_value),
                    Some(fv) if fv != hit_value => all_multi_hits_match = false,
                    _ => {}
                }
                multi_hit_damage += hit_value;
                hits_read += 1;
            }
            multi_hit_count = hits_read;
        }

        if strict_tail.is_none() && switch_value == 54 && hit_count > multi_hit_count && multi_hit_count == 1 && all_multi_hits_match {
            if let Some(fv) = first_multi_hit_value {
                multi_hit_count = hit_count;
                multi_hit_damage = fv * hit_count;
            }
        }
        if strict_tail.is_none() && should_use_repeated_hit_damage(switch_value, second_value, multi_hit_count, first_multi_hit_value, all_multi_hits_match) {
            final_damage = first_multi_hit_value.unwrap_or(final_damage);
        }
        if let Some((end, _field, count, damage)) = strict_tail {
            offset = end;
            multi_hit_count = count;
            multi_hit_damage = damage;
        }
        if multi_hit_count > 0 && multi_hit_damage > 0 && final_damage > multi_hit_damage {
            final_damage -= multi_hit_damage;
        }

        // Heal/life-steal suffix: [0x03, 0x00] marker + HealAmount VarInt
        if offset + 1 < packet.len() && packet[offset] == 0x03 && packet[offset + 1] == 0x00 {
            offset += 2;
            let _ = try_read_varint(packet, &mut offset);
        }

        if actor_value != target_value {
            out.push(Hit {
                actor: actor_value as u32,
                target: target_value as u32,
                skill: exact_skill_code as i32,
                // As upstream's `ParsedDamagePacket::total_damage`: the hit and its additional hits.
                damage: i64::from(final_damage) + i64::from(multi_hit_damage),
                crit: damage_type == 3,
                specials,
                multi_hit_count,
            });
        }
    }
    out
}

/// The tail of a damage record after its value, when it has the shape the
/// game's own record confirms: `(end offset, layout-4 field, additional hits,
/// their damage)`. `None` when the bytes do not end cleanly at the next record.
fn parse_hit_tail(packet: &[u8], offset: usize, layout: i32, switch_value: i32, value: i32) -> Option<(usize, i32, i32, i32)> {
    parse_hit_tail_as(packet, offset, layout, switch_value, value)
        .or_else(|| (layout == 4).then(|| parse_hit_tail_as(packet, offset, 6, switch_value, value)).flatten())
}

fn parse_hit_tail_as(packet: &[u8], mut offset: usize, layout: i32, switch_value: i32, value: i32) -> Option<(usize, i32, i32, i32)> {
    let mut field = 0;
    if layout == 4 {
        field = try_read_varint(packet, &mut offset)?;
        if !(1..=25).contains(&field) {
            return None;
        }
    }
    let (mut count, mut damage) = (0, 0i64);
    if switch_value & 0x20 != 0 {
        count = try_read_varint(packet, &mut offset)?;
        if !(1..=25).contains(&count) {
            return None;
        }
        for _ in 0..count {
            damage += i64::from(try_read_varint(packet, &mut offset)?);
        }
        if damage >= i64::from(value) {
            return None;
        }
    }
    let rest = &packet[offset.min(packet.len())..];
    let clean_end = rest.is_empty() || (rest.len() >= 2 && rest[1] == 0x00 && (1..=7).contains(&rest[0])) || rest.starts_with(&OP_DAMAGE);
    clean_end.then_some((offset, field, count, damage as i32))
}

fn should_use_repeated_hit_damage(switch_value: i32, encoded_damage: i32, multi_hit_count: i32, first_multi_hit_value: Option<i32>, all_match: bool) -> bool {
    let Some(repeated) = first_multi_hit_value else { return false };
    if switch_value != 54 || multi_hit_count <= 0 || !all_match {
        return false;
    }
    let main_component = encoded_damage - multi_hit_count * repeated;
    if main_component > repeated {
        return false;
    }
    encoded_damage / 10 == repeated
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// Upstream's `additional_hits_are_read_from_the_record_tail` (stream_processor.rs): records
    /// from a live capture (2026-10-04, target 30001, actor 1395), checked there against the game's
    /// own Damage Analyzer. The same totals and additional hits here.
    #[test]
    fn reads_the_records_as_upstream_does() {
        let parse = |record: &str| {
            let mut packet = vec![0x00, 0x04, 0x38];
            packet.extend(hex(record));
            packet[0] = packet.len() as u8;
            let h = hits(&packet, |_| true);
            assert_eq!(h.len(), 1, "{record}");
            (h[0].damage, h[0].multi_hit_count)
        };
        assert_eq!(parse("b1ea013600f30a40c0f4007a038000010b199b5f01000000ac52a40d021818"), (1700, 2));
        assert_eq!(parse("b1ea013400f30ae0b7f800cd028bd3276101000000ac52d330010159"), (6227, 1));
        assert_eq!(parse("fe9e0224009e9b01c3f8f5000302792b156002000000ac52e10301060200"), (481, 1));
        assert_eq!(parse("fe9e0224009e9b01c18601001702a7a2980001000000ac52e401030303030100"), (228, 3));
        assert_eq!(parse("fe9e0204009e9b01c3f8f5000302792b156003000000ac52b7030300"), (439, 0));
        assert_eq!(parse("b1ea011600f30a40c0f40063028000010b199b5f01000000ac52d007"), (976, 0));
        let mut packet = vec![0x00, 0x04, 0x38];
        packet.extend(hex("b1ea011600f30a40c0f40063028000010b199b5f01000000ac52d007"));
        packet[0] = packet.len() as u8;
        let h = &hits(&packet, |_| true)[0];
        assert_eq!((h.target, h.actor), (30_001, 1395));
    }
}
