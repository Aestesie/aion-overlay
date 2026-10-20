/**
 * Training dummy runs, timed from your own damage on training dummies (the engine's `train`, sent
 * with every meter update whatever the meter follows): the meter is left alone.
 *
 * A run is started by hand (the Training page or overlay) or, with auto-start on, by your first hit
 * on a dummy; with auto-start on, a run started by hand waits for that hit too, and its clock starts
 * with it. It ends at its time limit or damage goal, or with Stop and save (kept, marked stopped) or
 * Cancel (dropped). After a run, auto-start waits until you have left the dummy alone for a few
 * seconds, so hitting on does not start the next one straight away. Runs are saved, with their
 * skills, to `<userData>/dummy-runs.json` (the last 300).
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { meterState, onMeter } from './meter.ts'
import { settings } from './settings.ts'
import { command, log, tracker } from './tracker.ts'
import { NO_DUMMY, nextRunName, type DummyPlan, type DummySkill, type DummyState } from '../shared/dummy.ts'
import type { MeterData } from '../shared/meter.ts'

const KEEP = 300
/** How long without a hit on a dummy before auto-start may start another run. */
const REARM_MS = 5_000
/** How often the clock is checked while a run goes on (a time limit ends it between hits too). */
const TICK_MS = 250
const file = (): string => join(app.getPath('userData'), 'dummy-runs.json')

let state: DummyState = structuredClone(NO_DUMMY)
let finishing = false
/** Your damage on dummies at the last update, the dummy hit last, and when you last hit one. */
let lastDamage = 0
let lastTarget: number | null = null
let lastHitAt = 0
let me: number | null = null
/** Auto-start may start a run (it waits after a run for you to leave the dummy alone). */
let armed = true
/** At the run's start: your dummy damage and your skills on the dummy, taken off at its end. */
let baseline = 0
let baseSkills = new Map<string, DummySkill>()
let ticker: NodeJS.Timeout | null = null

function load(): void {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<DummyState>
    state = { active: null, group: saved.group ?? 1, runs: saved.runs ?? [], lastHitAt: null }
  } catch {
    state = structuredClone(NO_DUMMY)
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

/** Your skills on a dummy so far (the Details window's numbers), by code and DoT. */
async function skillsOn(target: number | null): Promise<Map<string, DummySkill>> {
  if (target === null || me === null) return new Map()
  const view = await meterState.details({ kind: 'live', target })
  return new Map(
    (view?.skills ?? [])
      .filter((s) => s.actor === me)
      .map((s) => [`${s.code}-${s.dot}`, { code: s.code, name: s.name, damage: s.damage, hits: s.hits, crits: s.crits, dot: s.dot }]),
  )
}

/**
 * The run's clock starts now, counting your dummy damage from `from`. Its skills count from here
 * too: from nothing on a dummy first hit now, else from what is on it already (the hit that started
 * it, read a moment late, is then left out of the skills; never out of the damage).
 */
function clockStarts(from: number): void {
  const run = state.active
  if (!run) return
  run.startedAt = Date.now()
  baseline = from
  baseSkills = new Map()
  if (from > 0) void skillsOn(lastTarget).then((s) => (baseSkills = s))
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

/** Save the run with its skills on the dummy (what they did since it started). */
async function finish(finished: boolean): Promise<void> {
  const run = state.active
  if (!run || finishing) return
  finishing = true
  const after = await skillsOn(lastTarget)
  const skills = [...after.entries()]
    .map(([key, s]) => {
      const before = baseSkills.get(key)
      return { ...s, damage: s.damage - (before?.damage ?? 0), hits: s.hits - (before?.hits ?? 0), crits: s.crits - (before?.crits ?? 0) }
    })
    .filter((s) => s.damage > 0)
    .sort((a, b) => b.damage - a.damage)
  if (run.startedAt !== null && run.damage > 0) {
    const hits = skills.reduce((n, s) => n + s.hits, 0)
    const seconds = Math.max(1, run.elapsedMs / 1000)
    state.runs = [
      {
        id: `${Date.now()}`,
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
      },
      ...state.runs,
    ].slice(0, KEEP)
  }
  end()
  finishing = false
  changed(true)
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
  },
}
