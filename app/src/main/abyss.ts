/**
 * Abyss Points (shared/abyss.ts): this session's, and every gain kept for the PvP page's rift
 * farms. The engine tells each gain, by character (`abyss` events).
 *
 * The gains are saved to `<userData>/abyss.json` as `[at, gained, name]`, the last KEEP_MS of them,
 * a moment after each (a farm's burst is one write), so the rift farms outlive a restart.
 */
import { app } from 'electron'
import { readFileSync, writeFile, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { NO_ABYSS, riftFarms, type AbyssGain, type AbyssSession, type RiftFarm } from '../shared/abyss.ts'
import { earn } from '../shared/earnings.ts'

const KEEP_MS = 90 * 24 * 3_600_000
const SAVE_AFTER_MS = 3000

let session: AbyssSession = NO_ABYSS
let gains: AbyssGain[] | null = null
let farms: RiftFarm[] | null = null
let saveTimer: NodeJS.Timeout | null = null
const file = (): string => join(app.getPath('userData'), 'abyss.json')

function all(): AbyssGain[] {
  if (gains === null) {
    try {
      const saved = JSON.parse(readFileSync(file(), 'utf8')) as unknown
      gains = Array.isArray(saved) ? (saved as AbyssGain[]).filter((g) => Array.isArray(g) && typeof g[0] === 'number' && typeof g[1] === 'number') : []
    } catch {
      gains = [] // none saved yet, or unreadable: start empty
    }
  }
  return gains
}

function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeFile(file(), JSON.stringify(all()), () => {})
  }, SAVE_AFTER_MS)
}

function setSession(next: AbyssSession): void {
  session = next
  broadcast('tracker:abyss', session)
}

export const abyss = {
  session: (): AbyssSession => session,
  rifts: (): RiftFarm[] => (farms ??= riftFarms(all())),

  /** The engine's `abyss` event: the week's total, and what it gained (0: a login's, or a start). */
  read(ev: { points: number; limit: number; gained: number; name: string | null }, now = Date.now()): void {
    const next = { ...session, points: ev.points, limit: ev.limit }
    setSession(ev.gained > 0 ? earn(next, ev.gained, now) : next.lastAt === null ? { ...next, lastAt: now } : next)
    if (ev.gained <= 0) return
    const list = all()
    list.push([now, ev.gained, ev.name])
    const old = list.findIndex(([at]) => at > now - KEEP_MS)
    if (old > 0) list.splice(0, old)
    farms = riftFarms(list)
    broadcast('tracker:rifts', farms)
    save()
  },

  /** Start the session again (the Session page's reset); the kept gains stay. */
  reset(): void {
    setSession({ ...NO_ABYSS, points: session.points, limit: session.limit })
  },

  /** Write a pending save now (the app is quitting). */
  flush(): void {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    try {
      writeFileSync(file(), JSON.stringify(all()))
    } catch {
      // a full disk or a locked file: the last save stands
    }
  },
}
