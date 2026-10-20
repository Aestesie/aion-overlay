//! The records the pet tracker and the overlay need, read from one game frame
//! (`<length varint> <opcode, 2 bytes> <body>`) as the parser's frame tap hands
//! it over. Ported from the Python tracker's `protocol.py` (Lokthar / Nyerk),
//! with the pet records fixed after A2Tools' pet-souls plugin: a soul pickup
//! lists every pet it gives souls to, and `14 90` says a pet levelled.

use a2tools_dps_meter_lib::capture::stream_processor::read_varint;

pub const OP_SPAWN: [u8; 2] = [0x41, 0x36];
pub const OP_DEATH: [u8; 2] = [0x42, 0x36];
pub const OP_SOUL: [u8; 2] = [0x0D, 0x90];
pub const OP_LEVEL_UP: [u8; 2] = [0x14, 0x90];
pub const OP_CRYSTAL: [u8; 2] = [0x11, 0x90];
pub const OP_COLLECTION: [u8; 2] = [0x00, 0x90];
pub const OP_MAP_LOAD: [u8; 2] = [0x21, 0x36];
pub const OP_TELEPORT: [u8; 2] = [0x23, 0x36];
pub const OP_CASTS: [[u8; 2]; 2] = [[0x02, 0x38], [0x03, 0x38]];
pub const OP_SELF: [u8; 2] = [0x33, 0x36];
pub const OP_ITEM: [u8; 2] = [0x1B, 0x56];
pub const OP_FIELD_BOSSES: [u8; 2] = [0x01, 0x91];
pub const OP_SHOP: [u8; 2] = [0x91, 0x56];
pub const OP_KILL: [u8; 2] = [0x04, 0x8D];
pub const OP_PLAYER: [u8; 2] = [0x45, 0x36];
pub const OP_LEGION: [u8; 2] = [0x33, 0x8A];

/// `42 36`'s flag for a monster killed in combat (1: out of range, 7: gone).
pub const DEATH_FLAG_COMBAT: u32 = 3;
/// Pet ids are four digits (1001-1299 in the game's table): anything else in a
/// pet field is a misread, not a pet.
pub const PET_IDS: std::ops::RangeInclusive<u32> = 1000..=9999;
/// The most a pet's count can be (75 at Lv2): a count past it is a misread.
const MAX_SOULS: u32 = 1000;

/// `(value, bytes)`; `None` where no varint is.
fn varint(b: &[u8], at: usize) -> Option<(u32, usize)> {
    if at >= b.len() {
        return None;
    }
    let v = read_varint(b, at);
    (v.length > 0).then(|| (v.value as u32, v.length as usize))
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

fn f32_at(b: &[u8], at: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The frame's opcode.
pub fn opcode(frame: &[u8]) -> Option<[u8; 2]> {
    let (_, n) = varint(frame, 0)?;
    frame.get(n..n + 2)?.try_into().ok()
}

/// The frame's body, if its opcode is `op`.
fn body(frame: &[u8], op: [u8; 2]) -> Option<&[u8]> {
    let (_, n) = varint(frame, 0)?;
    (frame.get(n..n + 2)? == op).then(|| &frame[n + 2..])
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spawn {
    pub entity: u32,
    pub mob_code: Option<u32>,
}

/// `41 36 <entity varint> <mask> ...`: the mob code is the u24 before an
/// `00 (00|40) 02` marker within 60 bytes.
pub fn spawn(frame: &[u8]) -> Option<Spawn> {
    let b = body(frame, OP_SPAWN)?;
    let (entity, n) = varint(b, 0)?;
    let limit = (b.len().saturating_sub(2)).min(n + 60);
    let code = (n..limit)
        .find(|&i| b[i] == 0 && matches!(b[i + 1], 0x00 | 0x40) && b[i + 2] == 0x02)
        .filter(|&i| i >= n + 3)
        .map(|i| b[i - 3] as u32 | (b[i - 2] as u32) << 8 | (b[i - 1] as u32) << 16);
    Some(Spawn { entity, mob_code: code })
}

/// `42 36 <entity varint> <varint, always 0> <flag varint>`.
pub fn death(frame: &[u8]) -> Option<(u32, u32)> {
    let b = body(frame, OP_DEATH)?;
    let (entity, n) = varint(b, 0)?;
    let (_, m) = varint(b, n)?;
    let (flag, _) = varint(b, n + m)?;
    Some((entity, flag))
}

/// A kill credit: `04 8D <victim varint> <u32> <killer varint> <server u16>
/// <len><name> [<len><legion>] ... <last byte>`. Who got the killing blow on a
/// monster or player around you; the last byte is 01 when the victim was a
/// player. The same opcode links summons to their owners with no name: not a
/// credit. It is found anywhere in a frame, as it also comes embedded.
#[derive(Debug, Clone, PartialEq)]
pub struct KillCredit {
    pub victim: u32,
    pub killer: u32,
    pub server: u16,
    pub name: String,
    pub legion: Option<String>,
    pub player_victim: bool,
}

/// Every kill credit in `frame` (Python's `loot_owner_records`, plus the
/// legion and the player-victim byte from Nyerk 0.2.17's `parse_kill_credit`).
pub fn kill_credits(frame: &[u8]) -> Vec<KillCredit> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(at) = frame[i..].windows(2).position(|w| w == OP_KILL).map(|p| p + i) {
        i = at + 2;
        let Some(credit) = kill_credit_at(frame, i) else { continue };
        out.push(credit);
    }
    out
}

fn kill_credit_at(b: &[u8], at: usize) -> Option<KillCredit> {
    let (victim, n) = varint(b, at)?;
    if !(100..=9_999_999).contains(&victim) {
        return None;
    }
    let j = at + n + 4; // a u32: a skill id for a summon, 0 otherwise
    let (killer, n2) = varint(b, j)?;
    let j = j + n2;
    let server = u16_at(b, j)?;
    let (name, end) = text(b, j + 2, 36)?;
    if !name.chars().all(|c| !c.is_control()) {
        return None;
    }
    let legion = text(b, end, 48).map(|(s, _)| s).filter(|s| !s.is_empty());
    // The last byte of the record: Nyerk reads it as the frame's last byte, as
    // a credit is a frame of its own when it is a player's death.
    let player_victim = b.last() == Some(&1) && at == varint(b, 0).map_or(0, |(_, n)| n + 2);
    Some(KillCredit { victim, killer, server, name, legion, player_victim })
}

/// A length-prefixed UTF-8 string of 1..=max bytes at `at`, and where it ends.
fn text(b: &[u8], at: usize, max: usize) -> Option<(String, usize)> {
    let n = *b.get(at)? as usize;
    if !(1..=max).contains(&n) {
        return None;
    }
    let s = std::str::from_utf8(b.get(at + 1..at + 1 + n)?).ok()?;
    Some((s.to_string(), at + 1 + n))
}

/// A character name: 1-32 bytes of UTF-8 letters and digits.
fn name_at(b: &[u8], at: usize) -> Option<String> {
    let (s, _) = text(b, at, 32)?;
    s.chars().all(char::is_alphanumeric).then_some(s)
}

/// `0D 90 <count u8> count × (<pet u32> <amount u32>)`: souls picked up, sent
/// only to you. One kill can give souls for several pets: each is listed.
pub fn souls(frame: &[u8]) -> Option<Vec<(u32, u32)>> {
    let b = body(frame, OP_SOUL)?;
    let count = *b.first()? as usize;
    if count == 0 || b.len() < 1 + count * 8 {
        return None;
    }
    let mut out = Vec::with_capacity(count);
    for k in 0..count {
        let pet = u32_at(b, 1 + k * 8)?;
        let amount = u32_at(b, 5 + k * 8)?;
        if !PET_IDS.contains(&pet) || !(1..MAX_SOULS).contains(&amount) {
            return None;
        }
        out.push((pet, amount));
    }
    Some(out)
}

/// `14 90 <2 bytes> <pet u32> <level u32>`: a pet reached a level.
pub fn level_up(frame: &[u8]) -> Option<(u32, u32)> {
    let b = body(frame, OP_LEVEL_UP)?;
    let pet = u32_at(b, 2)?;
    let level = u32_at(b, 6)?;
    (PET_IDS.contains(&pet) && (1..=3).contains(&level)).then_some((pet, level))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Crystal {
    pub genus: u8,
    pub amount: u32,
    pub raw: Vec<u8>,
}

/// `11 90 01 <genus u8> <amount u32> 02`: genus crystals from a monster whose
/// pet is maxed. It names no pet: the kill just before it does.
pub fn crystal(frame: &[u8]) -> Option<Crystal> {
    let b = body(frame, OP_CRYSTAL)?;
    if b.len() < 6 || b[0] != 0x01 {
        return None;
    }
    let amount = u32_at(b, 2)?;
    (1..MAX_SOULS).contains(&amount).then(|| Crystal { genus: b[1], amount, raw: b.to_vec() })
}

/// The genus byte of `11 90`, as seen. Natura and Varian not captured yet.
pub fn crystal_genus(byte: u8) -> Option<&'static str> {
    match byte {
        1 => Some("fera"),
        2 => Some("cogni"),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Collection {
    /// pet -> level
    pub levels: Vec<(u32, u32)>,
    /// pet -> souls, as the Pets menu shows them
    pub souls: Vec<(u32, u32)>,
}

/// `00 90 <u32> <varint n> n × (<pet u32> <pet u32> <level u32>) <varint m>
/// m × (<pet u32> <souls u32>) ...`: your whole collection, sent once as you
/// enter the world. Anything that doesn't read as pets (a pet id out of
/// range, a level past 3, a count past 1000) gives no sync at all: better no
/// sync than a wrong one.
pub fn collection(frame: &[u8]) -> Option<Collection> {
    let b = body(frame, OP_COLLECTION)?;
    let mut pos = 4;
    let (n, ln) = varint(b, pos)?;
    pos += ln;
    let mut out = Collection::default();
    for _ in 0..n {
        let (pet, pet2, level) = (u32_at(b, pos)?, u32_at(b, pos + 4)?, u32_at(b, pos + 8)?);
        if pet != pet2 || !PET_IDS.contains(&pet) || level > 3 {
            return None;
        }
        out.levels.push((pet, level));
        pos += 12;
    }
    let (m, ln) = varint(b, pos)?;
    pos += ln;
    for _ in 0..m {
        let (pet, souls) = (u32_at(b, pos)?, u32_at(b, pos + 4)?);
        if !PET_IDS.contains(&pet) || souls >= MAX_SOULS {
            return None;
        }
        out.souls.push((pet, souls));
        pos += 8;
    }
    Some(out)
}

/// `21 36 <u32> <u32 map id> <8 bytes> <f32 x> <f32 y> <f32 z> ...`: every zone load.
pub fn map_load(frame: &[u8]) -> Option<(u32, f32, f32)> {
    let b = body(frame, OP_MAP_LOAD)?;
    if b.len() < 28 {
        return None;
    }
    Some((u32_at(b, 4)?, f32_at(b, 16)?, f32_at(b, 20)?))
}

/// `23 36 00 <5 bytes> <f32 x> <f32 y> <f32 z>`: entity 0, you, placed somewhere.
pub fn self_teleport(frame: &[u8]) -> Option<(f32, f32)> {
    let b = body(frame, OP_TELEPORT)?;
    if b.len() < 18 || b[0] != 0 {
        return None;
    }
    Some((f32_at(b, 6)?, f32_at(b, 10)?))
}

/// `02 38` / `03 38 <caster varint> 00 <target varint> <skill u32> ... <f32 x>
/// <f32 y>`: where the caster stands. The first plausible pair after the skill:
/// game coordinates stay within ±500,000, and values under 1,000 are other
/// fields read as floats.
pub fn cast(frame: &[u8]) -> Option<(u32, f32, f32)> {
    let b = OP_CASTS.iter().find_map(|&op| body(frame, op))?;
    let (actor, n) = varint(b, 0)?;
    let plausible = |v: f32| (1000.0..500_000.0).contains(&v.abs());
    (n + 6..(b.len().saturating_sub(8)).min(n + 24)).find_map(|off| {
        let (x, y) = (f32_at(b, off)?, f32_at(b, off + 4)?);
        (plausible(x) && plausible(y)).then_some((actor, x, y))
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Character {
    pub entity: u32,
    pub name: String,
    pub server: u16,
}

/// `33 36 <entity varint> <5 bytes> <len u8> <name> <server u16> ...`: you, on
/// every zone entry (logins included, right after the collection).
pub fn character(frame: &[u8]) -> Option<Character> {
    let b = body(frame, OP_SELF)?;
    let (entity, pos) = varint(b, 0)?;
    (pos..(pos + 12).min(b.len())).find_map(|p| {
        let name = name_at(b, p)?;
        let end = p + 1 + name.len();
        Some(Character { entity, server: u16_at(b, end)?, name })
    })
}

const KINA_ITEM: [u8; 4] = [0x3f, 0x33, 0x70, 0x37];

/// Your Kina balance: `1B 56 01 01 00 <u32> <u32> 3f 33 70 37 <balance u64>`.
/// The same opcode carries other stacks with other item bytes.
pub fn kina(frame: &[u8]) -> Option<u64> {
    let b = body(frame, OP_ITEM)?;
    if b.len() < 23 || b[0] != 0x01 || b[11..15] != KINA_ITEM {
        return None;
    }
    u64_at(b, 15)
}

#[derive(Debug, Clone, PartialEq)]
pub struct FieldBoss {
    pub id: u32,
    pub up: bool,
    /// up: when it spawned (0 since the 2026-10-14 patch); dead: when it respawns
    pub at_ms: u64,
}

fn plausible_ms(b: &[u8], at: usize) -> bool {
    u64_at(b, at).is_some_and(|v| (1_600_000_000_000..2_200_000_000_000).contains(&v))
}

/// `01 91 <u16> <world u32> <count u8>`, then per boss: up `01 <id varint>
/// <x y z f32> [1 byte] <spawned u64 ms>`, dead `00 <id varint> <respawns u64
/// ms>`: the map's field boss list, every ~3 s while the map is open. Some
/// entries carry a byte more before the time, so the time is found where an ms
/// timestamp fits.
pub fn field_bosses(frame: &[u8]) -> Option<(u32, Vec<FieldBoss>)> {
    let b = body(frame, OP_FIELD_BOSSES)?;
    let world = u32_at(b, 2)?;
    let n = *b.get(6)?;
    let mut pos = 7;
    let mut out = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let up = match b.get(pos)? {
            0 => false,
            1 => true,
            _ => return None,
        };
        let (id, ln) = varint(b, pos + 1)?;
        pos += 1 + ln;
        if up {
            pos += 12;
            if pos > b.len() {
                return None;
            }
        }
        pos += (0..5).find(|&k| plausible_ms(b, pos + k))?;
        out.push(FieldBoss { id, up, at_ms: u64_at(b, pos)? });
        pos += 8;
    }
    Some((world, out))
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ShopItem {
    pub slot: u32,
    pub item: u32,
    pub quantity: u64,
    pub currency: u8,
    pub base: u64,
    pub price: u64,
}

const SHOP_RECORD: usize = 34;

fn shop_record(b: &[u8], o: usize) -> Option<ShopItem> {
    if o + SHOP_RECORD > b.len() {
        return None;
    }
    let item = ShopItem {
        slot: u32_at(b, o)?,
        item: u32_at(b, o + 4)?,
        quantity: u64_at(b, o + 8)?,
        currency: b[o + 17],
        base: u64_at(b, o + 18)?,
        price: u64_at(b, o + 26)?,
    };
    let ok = (1..1 << 24).contains(&item.slot)
        && item.item >= 100_000_000
        && (1..1_000_000).contains(&item.quantity)
        && item.price > 0
        && item.price <= item.base
        && item.base < 1_000_000_000_000;
    ok.then_some(item)
}

/// `91 56 <tab u8> <count u8>`, then per item `<slot u32> <item u32> <quantity
/// u64> <discount tier u8> <currency u8> <base u64> <price u64>`, then `<next
/// restock u64 ms>`: one Black Cloud Merchant tab, as it is opened. Some
/// records start one byte later, so each is tried where expected and one on.
pub fn shop(frame: &[u8]) -> Option<(u8, Vec<ShopItem>, Option<u64>)> {
    let b = body(frame, OP_SHOP)?;
    let (tab, count) = (*b.first()?, *b.get(1)?);
    let mut o = 2;
    let mut items = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let (start, item) = [o, o + 1].into_iter().find_map(|s| shop_record(b, s).map(|r| (s, r)))?;
        items.push(item);
        o = start + SHOP_RECORD;
    }
    let next = u64_at(b, o).filter(|&t| (1_500_000_000_000..4_000_000_000_000).contains(&t));
    Some((tab, items, next))
}

/// A player coming into view: `45 36 <entity varint> <4 bytes> 17 <len><name>
/// <u32> <faction 01 02 01 | 02 02 02> ...`, and some 100-120 bytes on
/// `<server u16> <2 bytes> 00 00 00 00 <server u16> <len><legion>` (Nyerk 0.2.17).
#[derive(Debug, Clone, PartialEq)]
pub struct Player {
    pub entity: u32,
    pub name: String,
    pub server: Option<u16>,
    pub legion: Option<String>,
}

pub fn player(frame: &[u8]) -> Option<Player> {
    let b = body(frame, OP_PLAYER)?;
    let (entity, pos) = varint(b, 0)?;
    let (name, end) = (pos..(pos + 12).min(b.len())).find_map(|p| {
        let name = name_at(b, p)?;
        let end = p + 1 + name.len();
        Some((name, end))
    })?;
    let mut server = None;
    let mut legion = None;
    for k in end + 40..(end + 200).min(b.len().saturating_sub(10)) {
        let v = u16_at(b, k)?;
        if (1000..=9999).contains(&v) && b[k + 4..k + 8] == [0, 0, 0, 0] && u16_at(b, k + 8) == Some(v) {
            server = Some(v);
            legion = text(b, k + 10, 48).map(|(s, _)| s);
            break;
        }
    }
    Some(Player { entity, name, server, legion })
}

/// `33 8A <entity varint> <legion id u48> <server u16> <len><name>`: a player's
/// legion, yours included, resent every few seconds (Nyerk 0.2.17).
pub fn legion(frame: &[u8]) -> Option<(u32, String)> {
    let b = body(frame, OP_LEGION)?;
    let (entity, n) = varint(b, 0)?;
    let server = u16_at(b, n + 6)?;
    let (name, _) = text(b, n + 8, 48)?;
    (1000..=9999).contains(&server).then_some((entity, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// `<length varint> <opcode> <body>`, by the game's rule (body + opcode + 4).
    pub fn frame(op: [u8; 2], body: &[u8]) -> Vec<u8> {
        let mut v = (body.len() + 2 + 4) as u32;
        let mut out = Vec::new();
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out.extend_from_slice(&op);
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn a_soul_pickup_for_two_pets_reads_both() {
        // A2Tools' decoder test: [02, pet 1015 amount 1, pet 1120 amount 1].
        let f = frame(OP_SOUL, &hex("02 f7030000 01000000 60040000 01000000"));
        assert_eq!(souls(&f), Some(vec![(1015, 1), (1120, 1)]));
        let one = frame(OP_SOUL, &hex("01 ee030000 03000000"));
        assert_eq!(souls(&one), Some(vec![(1006, 3)]));
        // A pet id no pet has: a misread, not a soul.
        assert_eq!(souls(&frame(OP_SOUL, &hex("01 f22d0100 01000000"))), None);
    }

    #[test]
    fn a_level_up_names_the_pet_and_its_level() {
        let f = frame(OP_LEVEL_UP, &hex("0000 ee030000 02000000"));
        assert_eq!(level_up(&f), Some((1006, 2)));
    }

    #[test]
    fn a_collection_reads_and_garbage_does_not() {
        let mut body = hex("00000000 02");
        body.extend(hex("ee030000 ee030000 01000000 f7030000 f7030000 03000000"));
        body.extend(hex("02 ee030000 20000000 f7030000 00000000"));
        let c = collection(&frame(OP_COLLECTION, &body)).unwrap();
        assert_eq!(c.levels, vec![(1006, 1), (1015, 3)]);
        assert_eq!(c.souls, vec![(1006, 32), (1015, 0)]);
        // The count a misread gave Pet #77298 (3,845,597,724 souls): no sync.
        let mut bad = hex("00000000 00 01");
        bad.extend(hex("f22d0100 dc0d38e5"));
        assert_eq!(collection(&frame(OP_COLLECTION, &bad)), None);
    }

    #[test]
    fn the_character_record_names_you_and_your_server() {
        let f = frame(OP_SELF, &hex("a135 0000000000 04 4b736978 5004 ff"));
        assert_eq!(character(&f), Some(Character { entity: 6817, name: "Ksix".into(), server: 1104 }));
    }

    #[test]
    fn a_kill_credit_names_the_killer() {
        // victim 30001, a u32, killer 1395, server 1104, "Ksix", legion "Lokthar".
        let body = hex("b1ea01 00000000 f30a 5004 04 4b736978 07 4c6f6b74686172 00");
        let f = frame(OP_KILL, &body);
        let got = kill_credits(&f);
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].victim, got[0].killer, got[0].server), (30001, 1395, 1104));
        assert_eq!((got[0].name.as_str(), got[0].legion.as_deref()), ("Ksix", Some("Lokthar")));
        assert!(!got[0].player_victim);
        let mut pvp = body.clone();
        *pvp.last_mut().unwrap() = 1;
        assert!(kill_credits(&frame(OP_KILL, &pvp))[0].player_victim);
    }

    #[test]
    fn kina_and_the_shop_read_as_the_python_tracker_did() {
        let f = frame(OP_ITEM, &hex("01 0100 00000000 00000000 3f337037 be86390000000000"));
        assert_eq!(kina(&f), Some(3_770_046));
        let mut body = vec![104, 1];
        body.extend(1u32.to_le_bytes());
        body.extend(150_000_001u32.to_le_bytes());
        body.extend(1u64.to_le_bytes());
        body.extend([0, 1]);
        body.extend(1000u64.to_le_bytes());
        body.extend(900u64.to_le_bytes());
        body.extend(1_792_350_000_000u64.to_le_bytes());
        let (tab, items, next) = shop(&frame(OP_SHOP, &body)).unwrap();
        assert_eq!((tab, items.len(), items[0].price, next), (104, 1, 900, Some(1_792_350_000_000)));
    }
}
