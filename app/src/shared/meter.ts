/**
 * What the engine (engine/, Rust: A2Tools DPS Meter's parser) tells the app about the fight, and
 * what the meter window shows of it. The wire format is documented in engine/src/sidecar.rs; the
 * fields are A2Tools DPS Meter's `DpsData`.
 */

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
  combatPower: number
  /** You. */
  you: boolean
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

export const NO_METER: MeterData = { target: null, mode: 'bossTargets', battleTime: 0, rows: [], at: 0, ping: null }

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
    combatPower: p.combatPower,
    you: ev.localPlayerId !== null && Number(id) === ev.localPlayerId,
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
  return { target, mode, battleTime: ev.battleTime, rows, at, ping }
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
}

export interface DetailsView {
  source: DetailsSource
  title: string
  /** When the fight began (ms since epoch); 0 when unknown. */
  startedAt: number
  battleTime: number
  totalDamage: number
  maxHp: number
  actors: DetailsActor[]
  skills: DetailsSkill[]
  heals: DetailsSkill[]
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
}

/** A saved fight: A2Tools DPS Meter's `FightRecord`, the fields shown. */
export interface FightRecord {
  id: string
  bossName: string
  startTimeMs: number
  durationMs: number
  details: TargetDetails
  actors: { actorId: number; nickname: string; job: string }[]
}

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
  names: Map<number, { name: string; className: string | null }>,
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
      }
    })
    .sort((a, b) => b.damage - a.damage || b.heal - a.heal)
  return {
    source,
    title,
    startedAt: d.startTime ?? 0,
    battleTime: d.battleTime,
    totalDamage: d.totalTargetDamage,
    maxHp: d.maxHp ?? 0,
    actors,
    skills,
    heals,
  }
}
