// Copied from Nyerk (GPL-3.0), https://github.com/xCROv/aion2-nyerk
// app/src/shared/servers.ts at ddcdc48 (0.2.17); the server rules below are Lokthar's.

import serverNames from './serverNames.json'
import { REGIONS, type Region } from './timers.ts'

/**
 * Game servers by the id the game uses (in kill credits and player records): their short tag, as
 * the game shows cross-server players ("xKanekii [LUM]"). Learned one at a time: an id not here
 * shows as its number. Kaisinel 1104 from the owner's character (2026-10-13), LUM 2104 from the
 * owner reading the tag on a player whose records say 2104 (pvp_kills.pcap).
 */
export const SERVER_TAGS: Record<number, string> = {
  1104: 'KAI',
  2104: 'LUM',
}

/** Every server's English name, by id (A2Tools DPS Meter's table). */
const NAMES = (serverNames as { servers: Record<string, string> }).servers

export const serverName = (id: number): string | null => NAMES[String(id)] ?? null

/**
 * The tag the game shows beside a player from another server: the first three letters of its
 * name, as the two seen so far are (Kaisinel KAI, Lumiel LUM). An id with no name shows as its
 * number.
 */
export const serverTag = (id: number): string => SERVER_TAGS[id] ?? serverName(id)?.slice(0, 3).toUpperCase() ?? String(id)

/**
 * What a server's id says (A2Tools DPS Meter's rule, `presence.rs`): 1xxx are Elyos servers and
 * 2xxx Asmodian; the hundreds digit is the region (1 NA East, 2 NA West, 3 Europe, 4 South America,
 * 5 Asia; 0 Korea or Taiwan). Kaisinel is 1104: Elyos, NA East.
 */
export function serverFaction(id: number): 'elyos' | 'asmodians' | null {
  const side = Math.floor(id / 1000)
  return side === 1 ? 'elyos' : side === 2 ? 'asmodians' : null
}

const REGION_DIGIT: Record<number, Region> = { 1: 'na-east', 2: 'na-west', 3: 'europe', 4: 'south-america' }

/** The timers' region a server is in; null for one the timers have no region for. */
export function serverRegion(id: number): Region | null {
  if (!serverFaction(id)) return null
  return REGION_DIGIT[Math.floor(id / 100) % 10] ?? null
}

/** "Kaisinel · Elyos · NA East", for showing what was worked out from the server. */
export function serverLabel(id: number): string {
  const faction = serverFaction(id)
  const region = serverRegion(id)
  return [serverName(id), faction === 'elyos' ? 'Elyos' : faction === 'asmodians' ? 'Asmodian' : null, REGIONS.find((r) => r.id === region)?.label]
    .filter(Boolean)
    .join(' · ')
}
