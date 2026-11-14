/**
 * Abyss Points: this session's, per hour (shared/earnings.ts, as Kina), and the rift farms.
 *
 * The engine reads the week's total the game sends with every gain (`ab ff`) and tells each gain,
 * by character (a login's total is only a start: engine/src/tracker/mod.rs `abyss_read`). Every
 * gain is kept (main/abyss.ts), so the farms can be told after the fact:
 *
 * A rift farm is what one character earned during a Spacetime Rift: from its opening (the
 * Event Alerts' rift timer, shared/timers.ts) until 1 h 10 min after, when it is really over. Only
 * those that earned at least RIFT_MIN_POINTS are listed, so a rift you skipped (a quest's few
 * points in its window) does not show.
 */
import { NO_EARNINGS, type Earnings } from './earnings.ts'
import { TIMERS } from './timers.ts'

export interface AbyssSession extends Earnings {
  /** The week's total and its limit as the game last said; null until it has. */
  points: number | null
  limit: number | null
}

export const NO_ABYSS: AbyssSession = { ...NO_EARNINGS, points: null, limit: null }

/** One gain as kept: when, how much, and whose (null: no character known yet). */
export type AbyssGain = [at: number, gained: number, name: string | null]

/** A rift's window: from its opening until it is really over. */
export const RIFT_MS = 70 * 60_000
/** The least a rift's window must have earned to be listed as a farm. */
export const RIFT_MIN_POINTS = 1000

export interface RiftFarm {
  /** When the rift opened (ms). */
  start: number
  name: string | null
  points: number
  /** The window's first and last gain. */
  first: number
  last: number
}

const RIFT = TIMERS.find((t) => t.id === 'rift')!.schedule
if (RIFT.kind !== 'every') throw new Error('the rift timer is expected every few hours')
const PERIOD_MS = RIFT.every * 60_000
const OFFSET_MS = RIFT.offset * 60_000

/** The opening of the rift whose window `at` falls in, or null (between two rifts). */
export function riftOf(at: number): number | null {
  const start = Math.floor((at - OFFSET_MS) / PERIOD_MS) * PERIOD_MS + OFFSET_MS
  return at - start < RIFT_MS ? start : null
}

/** The rift farms in `gains` (oldest first), newest first. */
export function riftFarms(gains: readonly AbyssGain[]): RiftFarm[] {
  const farms = new Map<string, RiftFarm>()
  for (const [at, gained, name] of gains) {
    const start = riftOf(at)
    if (start === null) continue
    const key = `${start}|${name ?? ''}`
    const farm = farms.get(key)
    if (farm) {
      farm.points += gained
      farm.first = Math.min(farm.first, at)
      farm.last = Math.max(farm.last, at)
    } else farms.set(key, { start, name, points: gained, first: at, last: at })
  }
  return [...farms.values()].filter((f) => f.points >= RIFT_MIN_POINTS).sort((a, b) => b.start - a.start)
}
