/**
 * What the engine (engine/, Rust: A2Tools DPS Meter's parser) tells the app about the fight, and
 * what the meter window shows of it. The wire format is documented in engine/src/sidecar.rs; the
 * fields are A2Tools DPS Meter's `DpsData`.
 */
import type { BuffTrack, FightBuffs } from './buffs.ts'

/** One row of the meter: a player (or the Others row on an open-world boss). */
export interface MeterRow {
  /** The engine's id for them, for this zone. */
  id: number
  name: string
  /** English class name; null while unknown. */
  className: string | null
  dps: number
  damage: number
  /** 0..100 */
  share: number
  hps: number
  heal: number
  /** Damage taken from the targets on the meter. */
  taken: number
  /** 0..1 of its hits that crit. */
  critRate: number
  combatPower: number
  /** You. */
  you: boolean
  /** In your party's roster. */
  party: boolean
  /** Everyone outside your party, on an open-world boss. */
  others: boolean
}

export interface MeterTarget {
  id: number
  name: string
  boss: boolean
  /** 0 when unknown. */
  maxHp: number
  /** null when unknown. */
  hp: number | null
}

export interface MeterData {
  target: MeterTarget | null
  mode: TargetMode
  /** Milliseconds of the fight so far. */
  battleTime: number
  rows: MeterRow[]
  /** When main received it (ms since epoch). */
  at: number
  /** Your ping to the game server (ms); null until measured. */
  ping: number | null
  /** The meter knows which character is you (after a zone change or a login). */
  meKnown: boolean
  /** Your id, once known. */
  me: number | null
  /** Your own damage on training dummies, whatever the meter follows (training runs). */
  train: { damage: number; target: number; lastHit: number } | null
}

/** The engine's recordings of the game's traffic (for replaying a fight after a patch). */
export interface Recordings {
  /** Where they are kept; null until the engine said. */
  dir: string | null
  /** The file being written, if one is. */
  recording: string | null
  files: { name: string; path: string; bytes: number; modified: number }[]
}
export const NO_RECORDINGS: Recordings = { dir: null, recording: null, files: [] }

/** Which players the meter lists: you, you and your party, or everyone hitting the target. */
export type MeterPlayers = 'me' | 'party' | 'all'
/** What the meter ranks by. */
export type MeterStat = 'damage' | 'healing' | 'taken'
export const METER_STATS: { id: MeterStat; label: string }[] = [
  { id: 'damage', label: 'Damage' },
  { id: 'healing', label: 'Healing' },
  { id: 'taken', label: 'Taken' },
]
export const METER_PLAYERS: { id: MeterPlayers; label: string }[] = [
  { id: 'me', label: 'Only me' },
  { id: 'party', label: 'Me and party' },
  { id: 'all', label: 'Everyone' },
]
/** questlog's three target choices first; the rest under More. */
export const MAIN_TARGET_MODES: { id: TargetMode; label: string }[] = [
  { id: 'allTargets', label: 'All targets' },
  { id: 'bossTargets', label: 'Bosses' },
  { id: 'lastHitByMe', label: 'My target' },
]

/** The rows to show: the players chosen, ranked by the stat, each with its value and per second. */
export function meterRows(
  m: MeterData,
  players: MeterPlayers,
  stat: MeterStat,
): (MeterRow & { value: number; perSecond: number; part: number })[] {
  const seconds = Math.max(1, m.battleTime / 1000)
  const value = (r: MeterRow): number => (stat === 'damage' ? r.damage : stat === 'healing' ? r.heal : r.taken)
  const shown = m.rows.filter((r) => (players === 'all' ? true : players === 'me' ? r.you : r.you || (r.party && !r.others)))
  const total = shown.reduce((n, r) => n + value(r), 0) || 1
  return shown
    .map((r) => ({ ...r, value: value(r), perSecond: stat === 'damage' ? r.dps : stat === 'healing' ? r.hps : r.taken / seconds, part: (value(r) / total) * 100 }))
    .filter((r) => stat === 'damage' || r.value > 0)
    .sort((a, b) => b.value - a.value || a.id - b.id)
}

/** How long until the target dies at the damage per second it takes now; null when not a boss or not known. */
export function timeToKill(m: MeterData): number | null {
  const t = m.target
  if (!t?.boss || t.hp === null || t.hp <= 0) return null
  const dps = m.rows.reduce((n, r) => n + r.dps, 0)
  return dps > 0 ? (t.hp / dps) * 1000 : null
}

export const TARGET_MODES = ['bossTargets', 'mostDamage', 'mostRecent', 'lastHitByMe', 'allTargets', 'trainTargets'] as const
export type TargetMode = (typeof TARGET_MODES)[number]

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  bossTargets: 'Bosses',
  mostDamage: 'Most damaged',
  mostRecent: 'Most recent',
  lastHitByMe: 'My last hit',
  allTargets: 'All targets',
  trainTargets: 'Training dummy',
}

export const NO_METER: MeterData = { target: null, mode: 'bossTargets', battleTime: 0, rows: [], at: 0, ping: null, meKnown: false, me: null, train: null }

/** The parser names classes in Korean (`JobClass::class_name`); the game's English names. */
export const CLASS_NAMES: Record<string, string> = {
  검성: 'Gladiator',
  수호성: 'Templar',
  궁성: 'Ranger',
  살성: 'Assassin',
  마도성: 'Sorcerer',
  치유성: 'Cleric',
  정령성: 'Spiritmaster',
  호법성: 'Chanter',
  권성: 'Brawler',
}

/** Each class's colour, as A2Tools DPS Meter draws it. */
export const CLASS_COLORS: Record<string, string> = {
  Gladiator: '#4FD1C5',
  Templar: '#5F8CFF',
  Ranger: '#41D98A',
  Assassin: '#7BE35A',
  Sorcerer: '#9A6BFF',
  Cleric: '#F2C15A',
  Spiritmaster: '#E06BFF',
  Chanter: '#FF9A3D',
  Brawler: '#E85D5D',
}

/** The engine's `dps` event, as main receives it. */
export interface DpsEvent {
  map: Record<
    string,
    {
      job: string
      dps: number
      amount: number
      damageContribution: number
      nickname: string
      combatPower: number
      isOthers?: boolean
      hps?: number
      healAmount?: number
      critRate?: number
      taken?: number
      party?: boolean
    }
  >
  targetName: string
  targetMode: string
  targetId: number
  battleTime: number
  localPlayerId: number | null
  targetMaxHp: number
  targetTotalDamage: number
  targetCurrentHp: number
  targetIsBoss?: boolean
  train?: { damage: number; target: number; lastHit: number } | null
}

/** The engine's event, as the meter window shows it: rows sorted by damage, names in English. */
export function meterData(ev: DpsEvent, at: number, ping: number | null = null): MeterData {
  const rows: MeterRow[] = Object.entries(ev.map ?? {}).map(([id, p]) => ({
    id: Number(id),
    name: p.nickname || `#${id}`,
    className: CLASS_NAMES[p.job] ?? null,
    dps: p.dps,
    damage: p.amount,
    share: p.damageContribution,
    hps: p.hps ?? 0,
    heal: p.healAmount ?? 0,
    taken: p.taken ?? 0,
    critRate: p.critRate ?? 0,
    combatPower: p.combatPower,
    you: ev.localPlayerId !== null && Number(id) === ev.localPlayerId,
    party: p.party === true || p.combatPower > 0,
    others: p.isOthers === true,
  }))
  rows.sort((a, b) => b.damage - a.damage || a.id - b.id)
  const target: MeterTarget | null = ev.targetId
    ? {
        id: ev.targetId,
        name: ev.targetName,
        boss: ev.targetIsBoss === true,
        maxHp: ev.targetMaxHp,
        // A live HP reading when there is one, else what the max less the damage dealt leaves.
        hp: ev.targetCurrentHp >= 0 ? ev.targetCurrentHp : ev.targetMaxHp > 0 ? Math.max(0, ev.targetMaxHp - ev.targetTotalDamage) : null,
      }
    : null
  const mode = (TARGET_MODES as readonly string[]).includes(ev.targetMode) ? (ev.targetMode as TargetMode) : 'bossTargets'
  return { target, mode, battleTime: ev.battleTime, rows, at, ping, meKnown: ev.localPlayerId !== null, me: ev.localPlayerId, train: ev.train ?? null }
}

// ---- a fight's breakdown -----------------------------------------------------------------------

/** What the Details window shows: the live target's, or a saved fight's. */
export type DetailsSource = { kind: 'live'; target: number; actor?: number } | { kind: 'saved'; id: string; actor?: number }

/** One skill of one player (or one heal). */
export interface DetailsSkill {
  actor: number
  code: number
  name: string
  damage: number
  hits: number
  crits: number
  maxHit: number
  dot: boolean
  /** Hits from behind, perfect hits, double hits, parried hits, and multi-hits. */
  back: number
  perfect: number
  double: number
  parry: number
  multi: number
  /** When each hit landed, ms from the fight's start (the Rotation tab). */
  at: number[]
}

/** One player's defense in a fight: damage and hits taken, and healing done. */
export interface DetailsDefense {
  taken: number
  hitsTaken: number
  heal: number
}

export interface DetailsActor {
  id: number
  name: string
  className: string | null
  damage: number
  dps: number
  /** 0..100 of everyone's damage. */
  share: number
  heal: number
  /** From the party roster; 0 when not known. */
  combatPower: number
  you: boolean
}

export interface DetailsView {
  source: DetailsSource
  /** The buffs and debuffs on its players and its target; null when the fight has none recorded. */
  buffs: FightBuffs | null
  title: string
  /** When the fight began (ms since epoch); 0 when unknown. */
  startedAt: number
  battleTime: number
  totalDamage: number
  maxHp: number
  actors: DetailsActor[]
  skills: DetailsSkill[]
  heals: DetailsSkill[]
  /** Each player's defense, by id; null where not recorded. */
  defense: Record<number, DetailsDefense> | null
}

/** A2Tools DPS Meter's `TargetDetailsResponse`, the fields shown. */
export interface TargetDetails {
  targetId: number
  maxHp?: number
  totalTargetDamage: number
  battleTime: number
  startTime?: number
  skills: SkillEntry[]
  healSkills?: SkillEntry[]
  /** Live only (the engine's `details`): each player's defense on the target. */
  defense?: Record<string, DetailsDefense>
}
interface SkillEntry {
  actorId: number
  code: number
  name: string
  time: number
  dmg: number
  crit: number
  maxDmg?: number
  isDot?: boolean
  job?: string
  back?: number
  perfect?: number
  double?: number
  parry?: number
  multiHitCount?: number
  hitTimestamps?: number[]
}

/** A saved fight: A2Tools DPS Meter's `FightRecord`, the fields shown. */
export interface FightRecord {
  id: string
  bossName: string
  targetId: number
  /** Saved since the meter recorded buffs. */
  buffs?: BuffTrack[]
  startTimeMs: number
  durationMs: number
  details: TargetDetails
  actors: { actorId: number; nickname: string; job: string; damageReceived?: number; hitsReceived?: number; partyHeal?: number }[]
}

/** Your own damage on the meter's target, skill by skill: the skills window. */
export interface PersonalView {
  /** The target's name; null with no target (or none of your damage on it). */
  target: string | null
  battleTime: number
  dps: number
  damage: number
  skills: { code: number; name: string; damage: number; dps: number; share: number; dot: boolean }[]
}

export const NO_PERSONAL: PersonalView = { target: null, battleTime: 0, dps: 0, damage: 0, skills: [] }

/** One saved fight in the list: A2Tools DPS Meter's `FightSummary`. */
export interface FightSummary {
  id: string
  bossName: string
  startTimeMs: number
  durationMs: number
  totalDamage: number
  isTrain: boolean
  dungeonId: number
  memberJobs: string[]
}

/** Every player's skills and totals, from the engine's breakdown; names from `names`. */
export function detailsView(
  source: DetailsSource,
  title: string,
  d: TargetDetails,
  names: Map<number, { name: string; className: string | null; combatPower?: number; you?: boolean }>,
): DetailsView {
  const entry = (s: SkillEntry): DetailsSkill => ({
    actor: s.actorId,
    code: s.code,
    name: s.name || `#${s.code}`,
    damage: s.dmg,
    hits: s.time,
    crits: s.crit,
    maxHit: s.maxDmg ?? 0,
    dot: s.isDot === true,
    back: s.back ?? 0,
    perfect: s.perfect ?? 0,
    double: s.double ?? 0,
    parry: s.parry ?? 0,
    multi: s.multiHitCount ?? 0,
    at: s.hitTimestamps ?? [],
  })
  const skills = d.skills.map(entry).sort((a, b) => b.damage - a.damage)
  const heals = (d.healSkills ?? []).map(entry).sort((a, b) => b.damage - a.damage)
  const seconds = Math.max(1, d.battleTime / 1000)
  const total = skills.reduce((n, s) => n + s.damage, 0) || 1
  const ids = [...new Set([...skills, ...heals].map((s) => s.actor))]
  const jobOf = new Map(d.skills.map((s) => [s.actorId, s.job ?? '']))
  const actors = ids
    .map((id) => {
      const damage = skills.filter((s) => s.actor === id).reduce((n, s) => n + s.damage, 0)
      const known = names.get(id)
      return {
        id,
        name: known?.name ?? `#${id}`,
        className: known?.className ?? CLASS_NAMES[jobOf.get(id) ?? ''] ?? null,
        damage,
        dps: damage / seconds,
        share: (damage / total) * 100,
        heal: heals.filter((s) => s.actor === id).reduce((n, s) => n + s.damage, 0),
        combatPower: known?.combatPower ?? 0,
        you: known?.you === true,
      }
    })
    .sort((a, b) => b.damage - a.damage || b.heal - a.heal)
  return {
    source,
    buffs: null,
    title,
    startedAt: d.startTime ?? 0,
    battleTime: d.battleTime,
    totalDamage: d.totalTargetDamage,
    maxHp: d.maxHp ?? 0,
    actors,
    skills,
    heals,
    defense: d.defense ? Object.fromEntries(Object.entries(d.defense).map(([id, v]) => [Number(id), v])) : null,
  }
}
