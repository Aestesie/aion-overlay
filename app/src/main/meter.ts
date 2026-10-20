/**
 * The DPS meter's state in main: the engine's `dps` events turned into what the meter window
 * shows, and the meter's commands to the engine (through the tracker's process, main/tracker.ts).
 */
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { command, tracker } from './tracker.ts'
import { meterData, NO_METER, type DpsEvent, type MeterData } from '../shared/meter.ts'

let meter: MeterData = NO_METER
/** Requests for a target's details, answered in order. */
const detailWaiters: { target: number; resolve: (details: unknown) => void }[] = []

/** Tell the engine what the settings say: whether to send the meter, and which target it follows. */
function applySettings(): void {
  const cfg = settings.get('meter')
  command({ cmd: 'meter', on: cfg.enabled })
  command({ cmd: 'targetMode', mode: cfg.targetMode })
}

export function startMeter(): void {
  tracker.onEvent('ready', () => {
    meter = NO_METER
    applySettings()
  })
  tracker.onEvent('dps', (ev) => {
    meter = meterData(ev as unknown as DpsEvent, Date.now())
    broadcast('meter:dps', meter)
  })
  tracker.onEvent('details', (ev) => {
    const i = detailWaiters.findIndex((w) => w.target === ev['target'])
    if (i >= 0) detailWaiters.splice(i, 1)[0]!.resolve(ev)
  })
  let last = JSON.stringify([settings.get('meter').enabled, settings.get('meter').targetMode])
  settings.onChanged((all) => {
    const now = JSON.stringify([all.meter.enabled, all.meter.targetMode])
    if (now === last) return
    last = now
    applySettings()
  })
}

export const meterState = {
  meter: (): MeterData => meter,
  /** Start the fight over: no target, no damage. */
  reset(): void {
    command({ cmd: 'dpsReset' })
  },
  /** One target's breakdown by skill (A2Tools' TargetDetailsResponse); null if the engine is gone. */
  details(target: number, actors?: number[]): Promise<unknown> {
    if (!tracker.running()) return Promise.resolve(null)
    return new Promise((resolve) => {
      detailWaiters.push({ target, resolve })
      command({ cmd: 'details', target, ...(actors ? { actors } : {}) })
      setTimeout(() => {
        const i = detailWaiters.findIndex((w) => w.resolve === resolve)
        if (i >= 0) detailWaiters.splice(i, 1)[0]!.resolve(null)
      }, 5000)
    })
  },
}
