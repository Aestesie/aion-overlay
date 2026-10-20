/**
 * Buffs and debuffs ("abnormals" in the game's data), from A2Tools DPS Meter's buff timeline
 * (capture/abnormal.rs, combat/fight_buffs.rs): what is on your character now (the buffs overlay),
 * and a fight's tracks (the Details window's Buffs tab).
 */

/** One buff on your character now, its stacks counted: the engine's `buffs` event. */
export interface Buff {
  /** The game's `SkillAbnormal` id. */
  id: number
  stacks: number
  /** When it runs out, ms since the epoch on the server's clock; null when it never does. */
  endsAt: number | null
  startedAt: number
  /** Who put it on (an entity id); 0 when not named. */
  by: number
  /** The skill that applied it, for its icon when the buff has none. */
  skill: number | null
  /** Yours: you cast it. */
  mine: boolean
  /** Cast by something that is not a player: a monster's debuff. */
  debuff: boolean
  /** On with no timer: a passive, a toggle. */
  passive: boolean
}

/** One buff from one caster on one of a fight's players, or on its target: upstream's `BuffTrack`. */
export interface BuffTrack {
  /** Whom it was on: a player's id, or the fight's target. */
  on: number
  /** On one of that player's summons. */
  summon?: boolean
  id: number
  /** Who applied it, a summon resolved to its owner; 0 when not named. */
  by: number
  skill?: number
  /** On through the whole fight with no timer. */
  passive?: boolean
  /** "start,end,stacks,how;..." in ms from the fight's start. */
  segs?: string
  /** Time on within the fight, in ms. */
  up: number
}

/** A fight's buffs: its tracks, and the window they are cut to. */
export interface FightBuffs {
  targetId: number
  durationMs: number
  tracks: BuffTrack[]
}

/** A track's times on, as [start, end] in ms from the fight's start, cut to the fight. */
export function trackSegments(t: BuffTrack, durationMs: number): [number, number][] {
  if (t.passive) return [[0, durationMs]]
  const out: [number, number][] = []
  for (const part of (t.segs ?? '').split(';')) {
    const [start, end] = part.split(',').map(Number)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const from = Math.max(0, start!)
    const to = Math.min(durationMs, end!)
    if (to > from) out.push([from, to])
  }
  return out
}
