/**
 * The DPS meter's state in main: the engine's `dps` and `ping` events turned into what the meter
 * window shows, a fight's breakdown for the Details window (live, or a saved fight), the saved
 * fights for the History page, your buffs for the buffs overlay, and the meter's commands to the
 * engine (through the tracker's process, main/tracker.ts).
 */
import { broadcast } from './broadcast.ts'
import { tr } from './i18n.ts'
import { settings } from './settings.ts'
import { command, tracker } from './tracker.ts'
import type { Buff, BuffTrack, FightBuffs } from '../shared/buffs.ts'
import {
  CLASS_NAMES,
  detailsView,
  meterData,
  NO_METER,
  type DetailsActor,
  type DetailsDefense,
  type DetailsSkill,
  type DetailsSource,
  type DetailsView,
  type DpsEvent,
  type FightRecord,
  type FightSummary,
  type MeterData,
  type PersonalView,
  type TargetDetails,
  NO_PERSONAL,
  NO_RECORDINGS,
  type Recordings,
} from '../shared/meter.ts'

const ASK_TIMEOUT_MS = 5000

let meter: MeterData = NO_METER
let ping: number | null = null
let buffs: Buff[] = []
let recordings: Recordings = NO_RECORDINGS
const meterListeners = new Set<(m: MeterData) => void>()

/** Told of every meter update (training dummy runs). */
export function onMeter(fn: (m: MeterData) => void): void {
  meterListeners.add(fn)
}

/** Requests waiting for the engine's answer, by the answer's type; answered in order. */
const waiting: { type: string; match: (ev: Record<string, unknown>) => boolean; done: (ev: Record<string, unknown> | null) => void }[] = []

/** Send `cmd` and wait for the engine's `type` event that `match`es (null if it never comes). */
function ask(cmd: Record<string, unknown>, type: string, match: (ev: Record<string, unknown>) => boolean = () => true): Promise<Record<string, unknown> | null> {
  if (!tracker.running()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const w = { type, match, done: resolve }
    waiting.push(w)
    command(cmd)
    setTimeout(() => {
      const i = waiting.indexOf(w)
      if (i >= 0) waiting.splice(i, 1)[0]!.done(null)
    }, ASK_TIMEOUT_MS)
  })
}

function answer(ev: Record<string, unknown>): void {
  const i = waiting.findIndex((w) => w.type === ev['type'] && w.match(ev))
  if (i >= 0) waiting.splice(i, 1)[0]!.done(ev)
}

/** Tell the engine what the settings say: whether to send the meter, and which target it follows. */
function applySettings(): void {
  const cfg = settings.get('meter')
  command({ cmd: 'meter', on: cfg.enabled })
  command({ cmd: 'targetMode', mode: cfg.targetMode })
  command({ cmd: 'buffs', on: settings.get('buffs').enabled || settings.get('buffs').cc })
}

export function startMeter(): void {
  tracker.onEvent('ready', () => {
    meter = NO_METER
    ping = null
    buffs = []
    applySettings()
  })
  tracker.onEvent('dps', (ev) => {
    meter = meterData(ev as unknown as DpsEvent, Date.now(), ping)
    broadcast('meter:dps', meter)
    for (const fn of meterListeners) fn(meter)
  })
  tracker.onEvent('ping', (ev) => {
    ping = (ev['ms'] as number | null) ?? null
    meter = { ...meter, ping }
    broadcast('meter:dps', meter)
  })
  tracker.onEvent('buffs', (ev) => {
    buffs = (ev['buffs'] as Buff[] | undefined) ?? []
    broadcast('buffs:list', buffs)
  })
  tracker.onEvent('historyChanged', () => broadcast('history:changed', Date.now()))
  for (const type of ['details', 'history', 'fight', 'pvpFight', 'recordings']) tracker.onEvent(type, answer)
  // A recording started or stopped: the list again, with it.
  tracker.onEvent('recording', () => void meterState.recordings().then((r) => broadcast('recordings:changed', r)))
  let last = JSON.stringify([settings.get('meter').enabled, settings.get('meter').targetMode, settings.get('buffs').enabled, settings.get('buffs').cc])
  settings.onChanged((all) => {
    const now = JSON.stringify([all.meter.enabled, all.meter.targetMode, all.buffs.enabled, all.buffs.cc])
    if (now === last) return
    last = now
    applySettings()
  })
}

/** Names and classes for a live fight: the meter's rows. */
function liveNames(): Map<number, { name: string; className: string | null; combatPower: number; you: boolean }> {
  return new Map(meter.rows.map((r) => [r.id, { name: r.name, className: r.className, combatPower: r.combatPower, you: r.you }]))
}

/** A PvP fight as the engine saves it (tracker/pvp.rs), skill names added by the sidecar. */
interface PvpSide {
  entity: number
  name: string
  server: number | null
  className: string | null
  combatPower: number | null
}
interface PvpFight {
  id: string
  at: number
  /** An assist: someone else (`killer`) killed the player you were fighting. */
  outcome: 'kill' | 'death' | 'assist'
  killer?: string
  me: PvpSide
  opponent: PvpSide
  /** The other players in it: your allies who hit the opponent, theirs they hit (older fights: none). */
  others?: PvpSide[]
  startMs: number
  durationMs: number
  skills: (Omit<DetailsSkill, 'name'> & { name: string | null })[]
  /** What each player took (older fights: none, then it is what the other side dealt). */
  taken?: { entity: number; damage: number; hits: number }[]
}

/**
 * A PvP fight in the Details window: you, the other player and everyone else who hit them or was
 * hit by them as its rows, each with the damage they did and their skills, and the damage each took.
 */
async function pvpDetails(source: Extract<DetailsSource, { kind: 'pvp' }>): Promise<DetailsView | null> {
  const ev = await ask({ cmd: 'pvpFight', id: source.id }, 'pvpFight', (e) => e['id'] === source.id)
  const fight = ev?.['fight'] as PvpFight | null | undefined
  if (!fight) return null
  const seconds = Math.max(1, fight.durationMs / 1000)
  const skills: DetailsSkill[] = fight.skills.map((s) => ({ ...s, name: s.name || `Skill ${s.code}` }))
  const dealt = (id: number): DetailsSkill[] => skills.filter((s) => s.actor === id)
  const sum = (list: DetailsSkill[], f: (s: DetailsSkill) => number): number => list.reduce((n, s) => n + f(s), 0)
  const total = Math.max(1, sum(skills, (s) => s.damage))
  // Servers are 1xxx Elyos, 2xxx Asmodian: a player of the other thousand is an enemy.
  const faction = (side: PvpSide): number | null => (side.server ? Math.floor(side.server / 1000) : null)
  const enemy = (side: PvpSide): boolean =>
    side.entity === fight.opponent.entity || (faction(side) !== null && faction(fight.me) !== null && faction(side) !== faction(fight.me))
  const actor = (side: PvpSide, you: boolean): DetailsActor => {
    const damage = sum(dealt(side.entity), (s) => s.damage)
    return { id: side.entity, name: side.name, className: side.className, damage, dps: damage / seconds, share: (damage / total) * 100, heal: 0, combatPower: side.combatPower ?? 0, you, enemy: !you && enemy(side) }
  }
  const others = fight.others ?? []
  const defense: Record<number, DetailsDefense> = {}
  if (fight.taken) {
    for (const t of fight.taken) defense[t.entity] = { taken: t.damage, hitsTaken: t.hits, heal: 0 }
  } else {
    // Saved before `taken`: only the two of you, each taking what the other dealt.
    const by = (side: PvpSide): DetailsDefense => ({ taken: sum(dealt(side.entity), (s) => s.damage), hitsTaken: sum(dealt(side.entity), (s) => s.hits), heal: 0 })
    defense[fight.me.entity] = by(fight.opponent)
    defense[fight.opponent.entity] = by(fight.me)
  }
  return {
    source,
    buffs: null,
    title: `${fight.me.name} vs ${fight.opponent.name} · ${fight.outcome === 'kill' ? tr('you won') : fight.outcome === 'death' ? tr('you died') : tr('{name} got the kill', { name: fight.killer ?? tr('someone else') })}`,
    startedAt: fight.startMs,
    battleTime: fight.durationMs,
    totalDamage: sum(skills, (s) => s.damage),
    maxHp: 0,
    actors: [actor(fight.me, true), actor(fight.opponent, false), ...others.map((o) => actor(o, false))].sort((a, b) => b.damage - a.damage),
    skills,
    heals: [],
    defense,
  }
}

export const meterState = {
  meter: (): MeterData => meter,
  /** Start the fight over: no target, no damage (the engine saves the fights on it first). */
  reset(): void {
    command({ cmd: 'dpsReset' })
  },
  /** A fight's breakdown by player and skill: the live target's, or a saved fight's. */
  async details(source: DetailsSource): Promise<DetailsView | null> {
    if (source.kind === 'live') {
      const ev = await ask({ cmd: 'details', target: source.target }, 'details', (e) => e['target'] === source.target)
      if (!ev) return null
      const title = meter.target?.id === source.target ? meter.target.name : 'Target'
      const live = ev['fightBuffs'] as { durationMs: number; buffs: BuffTrack[] } | null | undefined
      const fightBuffs: FightBuffs | null = live ? { targetId: source.target, durationMs: live.durationMs, tracks: live.buffs } : null
      return { ...detailsView(source, title || 'Target', ev as unknown as TargetDetails, liveNames()), buffs: fightBuffs }
    }
    if (source.kind === 'pvp') return pvpDetails(source)
    if (source.kind !== 'saved') return null
    const ev = await ask({ cmd: 'fight', id: source.id }, 'fight', (e) => e['id'] === source.id)
    const fight = ev?.['fight'] as FightRecord | undefined
    if (!fight) return null
    const names = new Map(fight.actors.map((a) => [a.actorId, { name: a.nickname || `#${a.actorId}`, className: CLASS_NAMES[a.job] ?? null }]))
    const defense = Object.fromEntries(
      fight.actors.map((a) => [a.actorId, { taken: a.damageReceived ?? 0, hitsTaken: a.hitsReceived ?? 0, heal: a.partyHeal ?? 0 }]),
    )
    const fightBuffs: FightBuffs | null = fight.buffs ? { targetId: fight.targetId, durationMs: fight.durationMs, tracks: fight.buffs } : null
    return { ...detailsView(source, fight.bossName, fight.details, names), startedAt: fight.startTimeMs, buffs: fightBuffs, defense }
  },
  /** Your own damage on the meter's target, skill by skill (the skills window). */
  async personal(): Promise<PersonalView> {
    const me = meter.rows.find((r) => r.you)
    const target = meter.target
    if (!me || !target) return { ...NO_PERSONAL, battleTime: meter.battleTime }
    const ev = await ask({ cmd: 'details', target: target.id, actors: [me.id] }, 'details', (e) => e['target'] === target.id)
    if (!ev) return NO_PERSONAL
    const view = detailsView({ kind: 'live', target: target.id }, target.name, ev as unknown as TargetDetails, liveNames())
    const mine = view.skills.filter((s) => s.actor === me.id)
    const total = mine.reduce((n, s) => n + s.damage, 0) || 1
    const seconds = Math.max(1, view.battleTime / 1000)
    return {
      target: target.name,
      battleTime: meter.battleTime,
      dps: me.dps,
      damage: me.damage,
      skills: mine.map((s) => ({ code: s.code, name: s.name, damage: s.damage, dps: s.damage / seconds, share: (s.damage / total) * 100, dot: s.dot })),
    }
  },
  /** The recordings kept, and the one being written. */
  async recordings(): Promise<Recordings> {
    const ev = await ask({ cmd: 'recordings' }, 'recordings')
    if (ev) recordings = { dir: (ev['dir'] as string) ?? null, recording: (ev['recording'] as string | null) ?? null, files: (ev['files'] as Recordings['files']) ?? [] }
    return recordings
  },
  record(on: boolean): void {
    command({ cmd: 'record', on })
  },
  /** The recordings' folder, once the engine named it: the only folder the app opens. */
  recordingsDir: (): string | null => recordings.dir,
  /** What is on your character now. */
  buffs: (): Buff[] => buffs,
  /** The saved fights, newest first. */
  async history(): Promise<FightSummary[]> {
    const ev = await ask({ cmd: 'history' }, 'history')
    return (ev?.['fights'] as FightSummary[] | undefined) ?? []
  },
  deleteFight(id: string): void {
    command({ cmd: 'deleteFight', id })
  },
}
