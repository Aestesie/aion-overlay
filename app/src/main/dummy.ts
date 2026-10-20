/**
 * Training dummy runs, timed from your own damage on training dummies (the engine's `train`, sent
 * with every meter update whatever the meter follows): the meter is left alone.
 *
 * A run is started by hand (the Training page or overlay) or, with auto-start on, by your first hit
 * on a dummy; with auto-start on, a run started by hand waits for that hit too, and its clock starts
 * with it. It ends at its time limit or damage goal, or with Stop and save (kept, marked stopped) or
 * Cancel (dropped). After a run, auto-start waits until you have left the dummy alone for a few
 * seconds, so hitting on does not start the next one straight away. Runs are saved, with their
 * skills, to `<userData>/dummy-runs.json` (the last 300), and each with its whole breakdown (the
 * Details window's: skills, hits, defense, rotation, buffs, healing), cut to the run, in
 * `dummy-details.json`: the dummy's own numbers are the whole time you have hit it, so what was on
 * it when the run started is taken off, and its hit times and buffs are cut to the run's clock.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { meterState, onMeter } from './meter.ts'
import { settings } from './settings.ts'
import { command, log, tracker } from './tracker.ts'
import type { FightBuffs } from '../shared/buffs.ts'
import { NO_DUMMY, nextRunName, type DummyActive, type DummyPlan, type DummyState } from '../shared/dummy.ts'
import type { DetailsSkill, DetailsView, MeterData } from '../shared/meter.ts'

const KEEP = 300
/** How long without a hit on a dummy before auto-start may start another run. */
const REARM_MS = 5_000
/** How often the clock is checked while a run goes on (a time limit ends it between hits too). */
const TICK_MS = 250
const file = (): string => join(app.getPath('userData'), 'dummy-runs.json')
/** The runs' breakdowns, by run id: apart from the runs, which go to the windows on every update. */
const detailsFile = (): string => join(app.getPath('userData'), 'dummy-details.json')

let state: DummyState = structuredClone(NO_DUMMY)
let finishing = false
/** Your damage on dummies at the last update, the dummy hit last, and when you last hit one. */
let lastDamage = 0
let lastTarget: number | null = null
let lastHitAt = 0
let me: number | null = null
/** Auto-start may start a run (it waits after a run for you to leave the dummy alone). */
let armed = true
/** At the run's start: your dummy damage and the dummy's breakdown, taken off at its end. */
let baseline = 0
let baseView: DetailsView | null = null
let details: Record<string, DetailsView> | null = null
let ticker: NodeJS.Timeout | null = null

function load(): void {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<DummyState>
    state = { active: null, group: saved.group ?? 1, runs: saved.runs ?? [], lastHitAt: null }
  } catch {
    state = structuredClone(NO_DUMMY)
  }
}

function loadDetails(): Record<string, DetailsView> {
  if (details) return details
  try {
    details = JSON.parse(readFileSync(detailsFile(), 'utf8')) as Record<string, DetailsView>
  } catch {
    details = {}
  }
  return details
}

function saveDetails(): void {
  const all = loadDetails()
  const kept = new Set(state.runs.map((r) => r.id))
  for (const id of Object.keys(all)) if (!kept.has(id)) delete all[id]
  try {
    writeFileSync(detailsFile(), JSON.stringify(all))
  } catch (err) {
    log(`training dummy: breakdowns not saved: ${String(err)}`)
  }
}

function changed(save = false): void {
  if (save) {
    try {
      writeFileSync(file(), JSON.stringify({ group: state.group, runs: state.runs }))
    } catch (err) {
      log(`training dummy: not saved: ${String(err)}`)
    }
  }
  broadcast('dummy:state', state)
}

/** The dummy's breakdown so far (the Details window's), the whole time you have hit it. */
async function viewOf(target: number | null): Promise<DetailsView | null> {
  if (target === null || me === null) return null
  return meterState.details({ kind: 'live', target })
}

const skillKey = (s: DetailsSkill): string => `${s.code}-${s.dot}`

/**
 * One player's skills in `after` less those in `before`: what they did since. Their hits' times are
 * the later ones, moved to the run's clock (`offset` ms in). The biggest hit cannot be taken apart:
 * it is the biggest the whole time.
 */
function skillsSince(after: DetailsSkill[], before: DetailsSkill[], actor: number, offset: number): DetailsSkill[] {
  const base = new Map(before.filter((s) => s.actor === actor).map((s) => [skillKey(s), s]))
  return after
    .filter((s) => s.actor === actor)
    .map((s) => {
      const b = base.get(skillKey(s))
      const at = [...s.at].sort((x, y) => x - y).slice(b?.at.length ?? 0).map((t) => Math.max(0, t - offset))
      if (!b) return { ...s, at }
      return {
        ...s,
        damage: s.damage - b.damage,
        hits: s.hits - b.hits,
        crits: s.crits - b.crits,
        back: s.back - b.back,
        perfect: s.perfect - b.perfect,
        double: s.double - b.double,
        parry: s.parry - b.parry,
        multi: s.multi - b.multi,
        at,
      }
    })
    .filter((s) => s.damage > 0 || s.hits > 0)
    .sort((a, b) => b.damage - a.damage)
}

/** Your buffs and the dummy's, cut to the run: `offset` ms into the fight, `length` ms long. */
function buffsOf(b: FightBuffs | null, actor: number, offset: number, length: number): FightBuffs | null {
  if (!b) return null
  const tracks = b.tracks
    .filter((t) => t.on === actor || t.on === b.targetId)
    .flatMap((t) => {
      if (t.passive) return [{ ...t, up: length }]
      let up = 0
      const segs = (t.segs ?? '').split(';').flatMap((part) => {
        const [start, end, ...rest] = part.split(',')
        const from = Math.max(0, Number(start) - offset)
        const to = Math.min(length, Number(end) - offset)
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
        up += to - from
        return [[from, to, ...rest].join(',')]
      })
      return segs.length ? [{ ...t, segs: segs.join(';'), up }] : []
    })
  return { targetId: b.targetId, durationMs: length, tracks }
}

/** The run's breakdown: yours on the dummy since its clock started, as a fight of its own. */
function runView(id: string, run: DummyActive, after: DetailsView, before: DetailsView | null, actor: number): DetailsView {
  const startedAt = run.startedAt ?? Date.now()
  // Where the run starts in the dummy's fight: by the clocks (both epoch ms), else at its first hit.
  const later = skillsSince(after.skills, before?.skills ?? [], actor, 0).flatMap((s) => s.at)
  const byClock = after.startedAt ? startedAt - after.startedAt : -1
  const offset = byClock >= 0 && byClock <= after.battleTime ? byClock : later.length ? Math.min(...later) : 0
  const skills = skillsSince(after.skills, before?.skills ?? [], actor, offset)
  const heals = skillsSince(after.heals, before?.heals ?? [], actor, offset)
  const seconds = Math.max(1, run.elapsedMs / 1000)
  const you = after.actors.find((a) => a.id === actor)
  const d = after.defense?.[actor]
  const b = before?.defense?.[actor]
  return {
    source: { kind: 'run', id },
    buffs: buffsOf(after.buffs, actor, offset, run.elapsedMs),
    title: `${run.name} · training dummy`,
    startedAt,
    battleTime: run.elapsedMs,
    totalDamage: run.damage,
    maxHp: 0,
    actors: [
      {
        id: actor,
        name: you?.name ?? 'You',
        className: you?.className ?? null,
        damage: run.damage,
        dps: run.damage / seconds,
        share: 100,
        heal: heals.reduce((n, s) => n + s.damage, 0),
        combatPower: you?.combatPower ?? 0,
        you: true,
      },
    ],
    skills,
    heals,
    defense: d ? { [actor]: { taken: d.taken - (b?.taken ?? 0), hitsTaken: d.hitsTaken - (b?.hitsTaken ?? 0), heal: d.heal - (b?.heal ?? 0) } } : null,
  }
}

/**
 * The run's clock starts now, counting your dummy damage from `from`. Its breakdown counts from
 * here too: from nothing on a dummy first hit now, else from what is on it already (the hit that
 * started it, read a moment late, is then left out of the breakdown; never out of the damage).
 */
function clockStarts(from: number): void {
  const run = state.active
  if (!run) return
  run.startedAt = Date.now()
  baseline = from
  baseView = null
  if (from > 0) void viewOf(lastTarget).then((v) => (baseView = v))
}

/** A run as the settings say: its goal, and the next name in the group. */
function plan(name?: string): DummyPlan {
  const cfg = settings.get('dummy')
  return {
    name: name?.trim().slice(0, 60) || nextRunName(state),
    goal: cfg.goal,
    limitMs: cfg.goal === 'time' ? cfg.limitMs : null,
    damageGoal: cfg.goal === 'damage' ? cfg.damageGoal : null,
  }
}

function begin(p: DummyPlan): void {
  state.active = { ...p, group: state.group, startedAt: null, elapsedMs: 0, damage: 0, dps: 0 }
  armed = false
  if (ticker) clearInterval(ticker)
  ticker = setInterval(tick, TICK_MS)
}

function end(): void {
  state.active = null
  armed = false
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** The clock moved on: the run's time, and its end at its time limit. */
function tick(): void {
  const run = state.active
  if (!run || run.startedAt === null || finishing) return
  run.elapsedMs = Date.now() - run.startedAt
  run.dps = run.damage / Math.max(1, run.elapsedMs / 1000)
  if (run.goal === 'time' && run.limitMs !== null && run.elapsedMs >= run.limitMs) {
    run.elapsedMs = run.limitMs
    void finish(true)
    return
  }
  changed()
}

/** A meter update: your damage on dummies. */
function onUpdate(m: MeterData): void {
  me = m.me
  const now = Date.now()
  let previous = lastDamage
  const damage = m.train?.damage ?? 0
  // The combat data was cleared (a zone change): count on from nothing.
  if (damage < previous) {
    previous = 0
    baseline = 0
  }
  lastDamage = damage
  if (m.train) lastTarget = m.train.target
  const hit = damage > previous
  if (hit) {
    // The overlay shows while you train: told when you start hitting again.
    if (now - lastHitAt > 1_000) {
      state.lastHitAt = now
      if (!state.active) changed()
    }
    lastHitAt = now
  } else if (!armed && !state.active && now - lastHitAt > REARM_MS) {
    armed = true
  }

  let run = state.active
  if (!run) {
    if (!hit || !armed || !settings.get('dummy').autoStart) return
    begin(plan())
    run = state.active!
  }
  if (run.startedAt === null) {
    if (!hit) return
    clockStarts(previous)
  }
  run.damage = Math.max(0, damage - baseline)
  run.elapsedMs = now - (run.startedAt ?? now)
  run.dps = run.damage / Math.max(1, run.elapsedMs / 1000)
  if (run.goal === 'damage' && run.damageGoal !== null && run.damage >= run.damageGoal) void finish(true)
  else changed()
}

/** Save the run with its breakdown on the dummy (what you did since it started). */
async function finish(finished: boolean): Promise<void> {
  const run = state.active
  if (!run || finishing) return
  finishing = true
  const id = `${Date.now()}`
  const after = await viewOf(lastTarget)
  const view = after && me !== null ? runView(id, run, after, baseView, me) : null
  const skills = (view?.skills ?? [])
    .filter((s) => s.damage > 0)
    .map((s) => ({ code: s.code, name: s.name, damage: s.damage, hits: s.hits, crits: s.crits, dot: s.dot }))
  if (run.startedAt !== null && run.damage > 0) {
    if (view) loadDetails()[id] = view
    const hits = skills.reduce((n, s) => n + s.hits, 0)
    const seconds = Math.max(1, run.elapsedMs / 1000)
    state.runs = [
      {
        id,
        name: run.name,
        goal: run.goal,
        limitMs: run.limitMs,
        damageGoal: run.damageGoal,
        group: run.group,
        at: Date.now(),
        durationMs: run.elapsedMs,
        damage: run.damage,
        dps: run.damage / seconds,
        critRate: hits ? skills.reduce((n, s) => n + s.crits, 0) / hits : 0,
        finished,
        skills,
        details: view !== null,
      },
      ...state.runs,
    ].slice(0, KEEP)
  }
  end()
  finishing = false
  changed(true)
  if (view) saveDetails()
}

/** The engine sends your dummy damage while training can happen, even with the meter off. */
function applySettings(): void {
  const cfg = settings.get('dummy')
  command({ cmd: 'training', on: cfg.overlay || cfg.autoStart })
}

export function startDummy(): void {
  load()
  onMeter(onUpdate)
  applySettings()
  settings.onChanged((_all, key) => key === 'dummy' && applySettings())
  // The engine started again: it sends dummy damage only once told to.
  tracker.onEvent('ready', applySettings)
}

export const dummy = {
  get: (): DummyState => state,
  /** A run, from the settings' goal: on the clock now, or (auto-start on) from your first hit. */
  start(name?: string): void {
    if (state.active) return
    begin(plan(name))
    if (!settings.get('dummy').autoStart) clockStarts(lastDamage)
    changed()
  },
  /** End the run now: `save` keeps it (marked stopped) if you hit the dummy at all; else dropped. */
  stop(save: boolean): void {
    if (!state.active) return
    if (save && state.active.startedAt !== null) {
      void finish(false)
      return
    }
    end()
    changed()
  },
  newGroup(): void {
    if (state.runs.some((r) => r.group === state.group)) state.group += 1
    changed(true)
  },
  remove(id: string): void {
    state.runs = state.runs.filter((r) => r.id !== id)
    changed(true)
    saveDetails()
  },
  /** A run's breakdown, for the Details window; null for runs saved before breakdowns were kept. */
  details: (id: string): DetailsView | null => loadDetails()[id] ?? null,
}
