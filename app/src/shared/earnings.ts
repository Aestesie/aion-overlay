/**
 * Something earned this session, and per hour: what Kina (shared/kina.ts) and Abyss Points
 * (shared/abyss.ts) both count. Each gain adds up; the hour counts active time only: a gap between
 * gains counts up to IDLE_MS, so a break in town does not drag the rate down, and the rate stops
 * falling once you stop.
 */

export interface Earnings {
  earned: number
  /** Active time between the gains so far (see IDLE_MS). */
  activeMs: number
  /** When the last gain came: the active time runs on from here. */
  lastAt: number | null
  /** Each gain as [when, how much], the last HISTORY_MS of them: the timeline. */
  gains: [number, number][]
}

export const NO_EARNINGS: Earnings = { earned: 0, activeMs: 0, lastAt: null, gains: [] }

/** How far back the timeline goes. */
export const HISTORY_MS = 30 * 60_000
/** Each point of the timeline is the rate over this long before it. */
export const WINDOW_MS = 5 * 60_000
const STEP_MS = 60_000

/** The most a gap between gains counts towards the hour. */
export const IDLE_MS = 5 * 60_000
/** No rate before this much active time: one kill's worth is not an hourly rate. */
export const MIN_MS = 60_000

/** A gain of `gain` at `now`. */
export function earn<S extends Earnings>(s: S, gain: number, now: number): S {
  if (gain <= 0) return s
  const gap = s.lastAt === null ? 0 : Math.min(Math.max(now - s.lastAt, 0), IDLE_MS)
  const gains = [...s.gains.filter(([at]) => at > now - HISTORY_MS - WINDOW_MS), [now, gain] as [number, number]]
  return { ...s, earned: s.earned + gain, activeMs: s.activeMs + gap, lastAt: now, gains }
}

/** Earned per hour at `now`, or null before there is enough to tell. */
export function perHour(s: Earnings, now: number): number | null {
  if (!s.earned || s.lastAt === null) return null
  const ms = s.activeMs + Math.min(Math.max(now - s.lastAt, 0), IDLE_MS)
  return ms < MIN_MS ? null : (s.earned / ms) * 3_600_000
}

export interface EarnedPoint {
  at: number
  /** Earned per hour over the WINDOW_MS before `at`. */
  perHour: number
}

/**
 * The timeline: a point a minute over the last HISTORY_MS (from the first gain, if later), each
 * the rate over the 5 minutes before it, so a lull shows as a dip and a break as zero. Empty until
 * there are two points.
 */
export function series(s: Earnings, now: number): EarnedPoint[] {
  const first = s.gains[0]?.[0]
  if (first === undefined) return []
  const out: EarnedPoint[] = []
  for (let at = now; at >= Math.max(now - HISTORY_MS, first); at -= STEP_MS) {
    const sum = s.gains.reduce((n, [t, g]) => (t > at - WINDOW_MS && t <= at ? n + g : n), 0)
    out.push({ at, perHour: (sum / WINDOW_MS) * 3_600_000 })
  }
  return out.length < 2 ? [] : out.reverse()
}

/** 950, 12.3k, 1.25M. */
export function formatAmount(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : n < 100_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}
