/**
 * The engine (engine/, Rust) as a child process: it captures the game's traffic and runs A2Tools
 * DPS Meter's parser on it, for the DPS meter. Runs beside the Python tracker until the tracker's
 * features move into it (overlay-plan.md, phase 2).
 *
 * The protocol is JSON lines both ways (engine/src/main.rs documents it). Like the tracker, it is
 * restarted with a backoff if it dies and killed when the app exits.
 *
 * Environment overrides, for development:
 *   A2T_ENGINE  the engine executable; <repo>/engine/target/{release,debug}/ otherwise
 */
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { log, npcapInstalled } from './tracker.ts'
import { meterData, NO_METER, type DpsEvent, type EngineStatus, type MeterData } from '../shared/meter.ts'

const RESTART_DELAYS_MS = [1000, 3000, 10000, 30000]
const EXE = process.platform === 'win32' ? 'lokthar-engine.exe' : 'lokthar-engine'

let child: ChildProcessWithoutNullStreams | null = null
let stopping = false
let restarts = 0
let restartTimer: NodeJS.Timeout | null = null
let stderrTail: string[] = []
let status: EngineStatus = { state: 'off', detail: null }
let meter: MeterData = NO_METER
/** Requests for a target's details, answered in order. */
const detailWaiters: { target: number; resolve: (details: unknown) => void }[] = []

function setStatus(next: EngineStatus): void {
  if (next.state !== status.state || next.detail !== status.detail) {
    log(`engine: ${next.state}${next.detail ? ` (${next.detail})` : ''}`)
  }
  status = next
  broadcast('meter:status', status)
}

/** The repo's engine build, newest first: release, then debug. */
function devEngine(): string | null {
  let dir = resolve(app.getAppPath())
  for (let i = 0; i < 6; i++) {
    for (const profile of ['release', 'debug']) {
      const exe = join(dir, 'engine', 'target', profile, EXE)
      if (existsSync(exe)) return exe
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** An installed app runs the packaged engine (resources/engine); development, the repo's build. */
function engineExe(): string {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'engine', EXE)
    if (existsSync(packaged)) return packaged
    throw new Error(`The engine is missing from the install (${packaged}). Reinstall the app.`)
  }
  const exe = process.env['A2T_ENGINE'] ?? devEngine()
  if (!exe) throw new Error('No engine build found: run `cargo build --release` in engine/ (or set A2T_ENGINE).')
  return exe
}

export function startEngine(): void {
  if (child || !settings.get('meter').enabled) return
  stopping = false
  if (process.platform === 'win32' && !npcapInstalled()) {
    setStatus({ state: 'error', detail: 'Npcap is not installed. Install it from https://npcap.com, then restart the meter.' })
    return
  }
  let exe: string
  try {
    exe = engineExe()
  } catch (e) {
    setStatus({ state: 'error', detail: (e as Error).message })
    return
  }

  stderrTail = []
  setStatus({ state: 'starting', detail: null })
  const proc = spawn(exe, [], { cwd: dirname(exe), windowsHide: true })
  child = proc

  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) handleLine(line)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    const lines = chunk.split(/\r?\n/).filter(Boolean)
    for (const line of lines) log(`engine: ${line}`)
    stderrTail = [...stderrTail, ...lines].slice(-20)
  })
  proc.on('error', (err) => setStatus({ state: 'error', detail: `Could not start the engine: ${err.message}` }))
  proc.on('exit', (code) => {
    if (child === proc) child = null
    for (const w of detailWaiters.splice(0)) w.resolve(null)
    if (stopping) return
    const why = stderrTail.at(-1) ?? `exit code ${code}`
    if (restarts >= RESTART_DELAYS_MS.length) {
      setStatus({ state: 'error', detail: `The engine keeps stopping: ${why}` })
      return
    }
    const delay = RESTART_DELAYS_MS[restarts++]!
    setStatus({ state: 'exited', detail: `Engine stopped (${why}); restarting in ${delay / 1000}s` })
    restartTimer = setTimeout(startEngine, delay)
  })
}

function handleLine(line: string): void {
  let ev: Record<string, unknown>
  try {
    ev = JSON.parse(line)
  } catch {
    stderrTail = [...stderrTail, `unparsed: ${line}`].slice(-20)
    return
  }
  switch (ev['type']) {
    case 'ready':
      restarts = 0
      log(`engine ${ev['version']} ready`)
      command({ cmd: 'targetMode', mode: settings.get('meter').targetMode })
      break
    case 'status': {
      const state = ev['state'] as EngineStatus['state']
      const detail = state === 'locked' ? `Game port ${ev['port']}` : ((ev['detail'] as string | undefined) ?? null)
      setStatus({ state, detail })
      break
    }
    case 'dps':
      meter = meterData(ev as unknown as DpsEvent, Date.now())
      broadcast('meter:dps', meter)
      break
    case 'details': {
      const i = detailWaiters.findIndex((w) => w.target === ev['target'])
      if (i >= 0) detailWaiters.splice(i, 1)[0]!.resolve(ev)
      break
    }
    case 'error':
      log(`engine: ${ev['detail']}`)
      break
  }
}

function command(cmd: Record<string, unknown>): void {
  if (child?.stdin.writable) child.stdin.write(JSON.stringify(cmd) + '\n')
}

export const engine = {
  status: (): EngineStatus => status,
  meter: (): MeterData => meter,
  running: (): boolean => child !== null,
  /** Start the fight over: no target, no damage. */
  reset(): void {
    command({ cmd: 'dpsReset' })
  },
  /** Which target the meter follows; kept in the settings, so it survives a restart. */
  applyTargetMode(): void {
    command({ cmd: 'targetMode', mode: settings.get('meter').targetMode })
  },
  /** One target's breakdown by skill (A2Tools' TargetDetailsResponse); null if the engine is gone. */
  details(target: number, actors?: number[]): Promise<unknown> {
    if (!child) return Promise.resolve(null)
    return new Promise((resolve) => {
      detailWaiters.push({ target, resolve })
      command({ cmd: 'details', target, ...(actors ? { actors } : {}) })
    })
  },
  restart(): void {
    restarts = 0
    stopEngine()
    startEngine()
  },
}

/** Ask the engine to quit, and make sure it is gone. */
export function stopEngine(): void {
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  meter = NO_METER
  const proc = child
  child = null
  setStatus({ state: 'off', detail: null })
  if (!proc) return
  try {
    proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    proc.stdin.end()
  } catch {
    // already closed
  }
  // A capture thread blocked in Npcap may hold it up; past this it is killed.
  setTimeout(() => proc.exitCode === null && proc.kill(), 1500).unref()
}

/** For process exit, where timers never fire. */
export function killEngineNow(): void {
  stopping = true
  if (child && child.exitCode === null) child.kill()
  child = null
}
