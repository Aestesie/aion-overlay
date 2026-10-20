/**
 * What the engine (engine/, Rust: A2Tools DPS Meter's parser) tells the app about the fight, and
 * what the meter window shows of it. The wire format is documented in engine/src/main.rs; the
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
}

export type EngineState =
  | 'off' // the meter is turned off, or the app is asleep
  | 'starting'
  | 'listening' // capturing, the game connection not found yet
  | 'locked' // reading the game connection
  | 'error'
  | 'exited' // the engine stopped; restarting

export interface EngineStatus {
  state: EngineState
  detail: string | null
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

export const NO_METER: MeterData = { target: null, mode: 'bossTargets', battleTime: 0, rows: [], at: 0 }

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
export function meterData(ev: DpsEvent, at: number): MeterData {
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
  return { target, mode, battleTime: ev.battleTime, rows, at }
}
