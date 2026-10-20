/**
 * Training dummy runs (questlog.gg's Training Dummy page): your damage on a training dummy, against
 * the clock or to a damage goal, saved to compare one run with another. Timed in main (main/dummy.ts)
 * from the meter's own numbers while it follows training dummies.
 */

export type DummyGoal = 'time' | 'damage'

/** A run's settings: what the page's form says. */
export interface DummyPlan {
  name: string
  goal: DummyGoal
  /** Time goal: when the run ends, ms of fighting; null to run until stopped. */
  limitMs: number | null
  /** Damage goal: the damage that ends it. */
  damageGoal: number | null
}

export interface DummySkill {
  code: number
  name: string
  damage: number
  hits: number
  crits: number
  dot: boolean
}

export interface DummyRun extends DummyPlan {
  id: string
  /** Runs of one group are compared with each other ("New group" starts the next). */
  group: number
  /** When it ended (ms since epoch). */
  at: number
  /** How long you fought, ms. */
  durationMs: number
  damage: number
  dps: number
  critRate: number
  /** The goal was met (a time goal reached, or the damage done); false when stopped early. */
  finished: boolean
  skills: DummySkill[]
}

/** The run going on: waiting for the first hit (`startedAt` null), then on the clock. */
export interface DummyActive extends DummyPlan {
  group: number
  startedAt: number | null
  elapsedMs: number
  damage: number
  dps: number
}

export interface DummyState {
  active: DummyActive | null
  group: number
  runs: DummyRun[]
  /** When you last hit a training dummy (ms since epoch): the Training overlay shows for a while after. */
  lastHitAt: number | null
}

export const NO_DUMMY: DummyState = { active: null, group: 1, runs: [], lastHitAt: null }

/** The name a run gets when none is given: the next number in its group. */
export const nextRunName = (s: DummyState): string => `Run ${s.runs.filter((r) => r.group === s.group).length + 1}`
export const DUMMY_LIMITS: { id: number | null; label: string }[] = [
  { id: null, label: 'None' },
  { id: 30_000, label: '0:30' },
  { id: 60_000, label: '1:00' },
  { id: 120_000, label: '2:00' },
  { id: 180_000, label: '3:00' },
  { id: 300_000, label: '5:00' },
]
export const DUMMY_DAMAGE_GOALS = [1e6, 5e6, 10e6, 25e6, 50e6, 100e6]
