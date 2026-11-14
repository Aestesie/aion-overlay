/**
 * Kina earned this session, and per hour (shared/earnings.ts counts it). The tracker passes on the
 * balance whenever it changes (`1b 56`, the Kina stack); what was earned is worked out here from
 * the changes:
 * - Gains add up; spending (repairs, shops) takes nothing off: it is what farming earned.
 * - The first balance after entering the world is only a starting point: a character switch would
 *   otherwise count the other character's whole purse.
 */
import { earn, formatAmount, NO_EARNINGS, perHour, series, type EarnedPoint, type Earnings } from './earnings.ts'

export interface KinaSession extends Earnings {
  /** The last balance seen; null until one arrives (and again after entering the world). */
  balance: number | null
}

export const NO_KINA: KinaSession = { ...NO_EARNINGS, balance: null }

/** A new balance from the tracker, at `now`. */
export function kinaBalance(s: KinaSession, balance: number, now: number): KinaSession {
  if (s.balance === null) return { ...s, balance, lastAt: s.earned ? s.lastAt : now }
  return { ...earn(s, balance - s.balance, now), balance }
}

/** Entering the world (maybe as another character): the next balance is a new starting point. */
export const kinaRebase = (s: KinaSession): KinaSession => ({ ...s, balance: null })

/** Kina per hour at `now`, or null before there is enough to tell. */
export const kinaPerHour = perHour

export type KinaPoint = EarnedPoint
/** Kina per hour over the last half hour (shared/earnings.ts `series`). */
export const kinaSeries = series

/** 950, 12.3k, 1.25M. */
export const formatKina = formatAmount
