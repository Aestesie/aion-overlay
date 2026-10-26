/**
 * The packet log (Settings → Developer): the engine writes every game message it reads to a text
 * file, one line each, with the marks you add between them ("opened the map"), to find where the
 * game sends something by its time. Alt+Shift+R starts or stops it from the game (hotkeys.ts); while
 * it runs, Alt+Shift+M adds a mark (the key is only taken while the log runs), and a pill over the
 * game says so, staying a few seconds after it stops.
 */
import { globalShortcut, shell } from 'electron'
import { basename, dirname } from 'node:path'
import { broadcast } from './broadcast.ts'
import { meterState } from './meter.ts'
import { closePacketsHud, createPacketsHud } from './windows.ts'
import { command, log, tracker } from './tracker.ts'
import { NO_PACKET_LOG, type PacketLog } from '../shared/meter.ts'

const MARK_KEY = 'Alt+Shift+M'

/** The pill stays this long after the log stops, with where it went. */
const HUD_AFTER_MS = 5_000

let state: PacketLog = { ...NO_PACKET_LOG }
let hudTimer: NodeJS.Timeout | null = null

/** The pill: up while the log runs, gone a few seconds after. */
function hud(on: boolean): void {
  if (hudTimer) clearTimeout(hudTimer)
  hudTimer = null
  if (on) createPacketsHud()
  else hudTimer = setTimeout(closePacketsHud, HUD_AFTER_MS)
}

function changed(): void {
  broadcast('packets:state', state)
}

function markKey(on: boolean): void {
  if (!on) {
    if (globalShortcut.isRegistered(MARK_KEY)) globalShortcut.unregister(MARK_KEY)
    return
  }
  if (globalShortcut.isRegistered(MARK_KEY)) return
  if (!globalShortcut.register(MARK_KEY, () => packets.mark(`${MARK_KEY}`))) log(`hotkey ${MARK_KEY} is taken by another program`)
}

export function startPackets(): void {
  tracker.onEvent('packets', (ev) => {
    const on = ev['on'] === true
    const path = typeof ev['path'] === 'string' ? ev['path'] : state.path
    if (on && !state.on) log(`packet log: writing ${path}`)
    if (!on && state.on) log(`packet log: ${String(ev['count'])} messages in ${path}`)
    const was = state.on
    state = { ...state, on, path, count: Number(ev['count'] ?? state.count), startedAt: on ? (state.startedAt ?? Date.now()) : null }
    markKey(on)
    if (on !== was) hud(on)
    changed()
  })
  // The engine started again: its log, if one ran, ended with it.
  tracker.onEvent('ready', () => {
    if (!state.on) return
    state = { ...state, on: false, startedAt: null }
    markKey(false)
    hud(false)
    changed()
  })
}

export const packets = {
  get: (): PacketLog => state,
  set(on: boolean): void {
    if (on) state = { ...state, count: 0, marks: 0 }
    command({ cmd: 'packets', on })
  },
  mark(text: string): void {
    if (!state.on) return
    state = { ...state, marks: state.marks + 1 }
    command({ cmd: 'mark', text: text.slice(0, 200) })
  },
  /** The file, in its folder: only a packet log in the recordings' folder. */
  async show(): Promise<void> {
    const path = state.path
    const dir = meterState.recordingsDir() ?? (await meterState.recordings()).dir
    if (path && dir && dirname(path) === dir && /^packets-[\w-]+\.txt$/.test(basename(path))) shell.showItemInFolder(path)
  },
}
