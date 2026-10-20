/**
 * Hidden Cubes around you: how far each is and which way. Positions are the map data's (x, -y),
 * as Nearby reports yours; on the zone maps larger y is up (north), larger x is right (east).
 */
import type { Cube } from '@shared/tracker.ts'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export interface CubeBearing {
  cube: Cube
  /** Game units (centimetres); null without your position. */
  distance: number | null
  /** N, NE, ...; null without your position. */
  direction: (typeof COMPASS)[number] | null
}

export function cubeBearings(cubes: Cube[], you: [number, number] | null): CubeBearing[] {
  return cubes
    .map((cube) => {
      if (!you) return { cube, distance: null, direction: null }
      const dx = cube.position[0] - you[0]
      const dy = cube.position[1] - you[1]
      const angle = (Math.atan2(dx, dy) * 180) / Math.PI
      return { cube, distance: Math.hypot(dx, dy), direction: COMPASS[Math.round(((angle + 360) % 360) / 45) % 8]! }
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
}

/** "85 m" (the game's units are centimetres). */
export const meters = (units: number): string => `${Math.round(units / 100)} m`
