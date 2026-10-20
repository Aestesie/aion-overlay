/**
 * Persisted settings: typed, with defaults, and normalised at the IPC boundary so a hand-edited
 * file or a renderer bug can never store something the app then trips over.
 */

import { TARGET_MODES, type TargetMode } from './meter.ts'
import { defaultShown, leadChoices, REGIONS, TIMERS, type Region, type TimerId } from './timers.ts'

export interface Point {
  x: number
  y: number
}

export interface Settings {
  /** Where the floating icon sits, in screen DIPs; null = bottom right of the primary display. */
  bubble: Point | null
  /** The dashboard's size, and where it was left (null = the middle of the primary display). */
  panel: { width: number; height: number }
  panelPosition: Point | null
  /** Keep the panel above the game while it is open. */
  panelOnTop: boolean

  hud: {
    enabled: boolean
    /** Top-left in screen DIPs; null = top right of the primary display. */
    position: Point | null
    /** 'recent': pets that gained souls this session; 'pinned': the pets pinned in the panel. */
    mode: 'recent' | 'pinned'
    /** The Nearby section at the top: soul monsters around you, by the pet they drop. */
    nearby: boolean
    /** How many pets the Nearby section lists. */
    nearbyCount: number
    pinned: number[]
    /** How many recent pets 'recent' shows. */
    recentCount: number
    toasts: boolean
    opacity: number
    scale: number
    /** Hide the HUD when no game traffic has been seen for a while. */
    hideWithoutGame: boolean
    /**
     * Seconds without a kill, soul or crystal before the HUD clears itself and hides until the
     * next fight; 0 = never.
     */
    idleHideSeconds: number
    /** Pop up the Black Cloud Merchant's pets worth buying when one of its tabs is opened. */
    merchant: boolean
    /** This session's Kina per hour, at the top right. */
    kina: boolean
    /** Hidden Cubes in view at the top, with how far and which way. */
    cubes: boolean
    /** A chime when a Hidden Cube comes into view. */
    cubeSound: boolean
  }

  /** The map overlay: your zone around you, your tracked pets' spawns and the Hidden Cubes. */
  minimap: { enabled: boolean; position: Point | null; size: number; opacity: number; zoom: number }

  /** Where the Black Cloud Merchant window sits (top-left, screen DIPs); null = top centre. */
  merchantWindow: Point | null
  /** Where the Details window (a fight's breakdown) sits; null = the middle of the screen. */
  detailsWindow: Point | null

  /** The timers' countdown bar over the game: on, where (null = top centre), how opaque. */
  timerBar: { enabled: boolean; position: Point | null; opacity: number }

  /** The kill feed over the game: open (from the PvP page), and where (null = top right). */
  killFeed: { open: boolean; position: Point | null }

  /**
   * Your buffs and debuffs over the game: each one's icon, stacks and time left (A2Tools DPS
   * Meter's buff timeline). Icons `size` px, `perRow` to a row; debuffs on a row of their own.
   */
  buffs: { enabled: boolean; position: Point | null; opacity: number; size: number; perRow: number; debuffs: boolean; passives: boolean }

  /** Your own skills on the meter's target, as a window of their own. */
  skills: { enabled: boolean; position: Point | null; rows: number; opacity: number }

  /** The DPS meter: its own window, fed by the engine (A2Tools DPS Meter's parser). */
  meter: {
    enabled: boolean
    /** Top-left in screen DIPs; null = left of the primary display. */
    position: Point | null
    /** Which target it follows. */
    targetMode: TargetMode
    /** How many players it lists. */
    rows: number
    opacity: number
  }

  /** Hide every overlay window from screenshots, OBS and Discord (WDA_EXCLUDEFROMCAPTURE). */
  hideFromCapture: boolean

  /** Your side: its zones are listed first where a soul drops. */
  faction: 'elyos' | 'asmodians'
  /** Your level, to point out monsters close enough to it for souls to drop well; null = unset. */
  playerLevel: number | null

  /** Event Alerts and Field Bosses: which events alert, and how (a chime; the bubble shaking). */
  timers: {
    /** The server region: weekly events are at its own local time. */
    region: Region
    enabled: Record<TimerId, boolean>
    /** Minutes before each start to alert. */
    lead: Record<TimerId, number>
    sound: boolean
    /** 0..1 */
    volume: number
    shake: boolean
    /** Listed in the Event Alerts and Field Bosses pages; only these alert. */
    shown: Record<TimerId, boolean>
  }

  /** Leave pets at the cap (Lv3: no more souls) out of the collection, Nearby and the HUD. */
  hideMaxed: boolean

  /**
   * While Aion 2 is not running: no bubble, no HUD, no capture, only the tray icon. Everything
   * comes back when the game starts.
   */
  sleepWithoutGame: boolean

  /**
   * Hide every overlay while another program is in front (an alt-tab to Discord), and show them
   * again when the game is. The overlay's own panel, clicked into, counts as the game.
   */
  hideWhenGameAway: boolean

  /**
   * Sync the field bosses to the Lokthar site's timers (main/lokthar.ts): off until turned on with
   * a token. The only network request the app makes, to `url` alone.
   */
  lokthar: {
    sync: boolean
    /** The site, e.g. https://lokthar.com: https only (http for localhost, to test against a dev server). */
    url: string
    /** From the site: bin/rails 'overlay:token[you]'. */
    token: string
  }

  tracker: {
    /** The collection file; empty = <userData>/collection.json. */
    dataFile: string
  }
}

export type SettingKey = keyof Settings

export const SETTINGS_DEFAULTS: Settings = {
  bubble: null,
  panel: { width: 1100, height: 720 },
  panelPosition: null,
  panelOnTop: true,
  hud: {
    enabled: true,
    position: null,
    mode: 'recent',
    nearby: true,
    nearbyCount: 3,
    pinned: [],
    recentCount: 3,
    toasts: true,
    opacity: 0.92,
    scale: 1,
    hideWithoutGame: true,
    idleHideSeconds: 45,
    merchant: true,
    kina: true,
    cubes: true,
    cubeSound: true,
  },
  minimap: { enabled: true, position: null, size: 260, opacity: 0.92, zoom: 6 },
  merchantWindow: null,
  detailsWindow: null,
  timerBar: { enabled: true, position: null, opacity: 0.92 },
  killFeed: { open: false, position: null },
  skills: { enabled: true, position: null, rows: 6, opacity: 0.92 },
  buffs: { enabled: true, position: null, opacity: 0.92, size: 34, perRow: 10, debuffs: true, passives: false },
  meter: { enabled: true, position: null, targetMode: 'bossTargets', rows: 8, opacity: 0.92 },
  hideFromCapture: false,
  faction: 'elyos',
  playerLevel: null,
  hideMaxed: true,
  timers: {
    region: 'south-america',
    enabled: Object.fromEntries(TIMERS.map((t) => [t.id, t.defaultOn])) as Record<TimerId, boolean>,
    lead: Object.fromEntries(TIMERS.map((t) => [t.id, t.lead])) as Record<TimerId, number>,
    sound: true,
    volume: 0.5,
    shake: true,
    shown: Object.fromEntries(TIMERS.map((t) => [t.id, defaultShown(t)])) as Record<TimerId, boolean>,
  },
  sleepWithoutGame: true,
  hideWhenGameAway: true,
  lokthar: { sync: false, url: 'https://lokthar.com', token: '' },
  tracker: { dataFile: '' },
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

const point = (v: unknown): Point | null => {
  const p = v as Partial<Point> | null
  return p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: Math.round(p.x), y: Math.round(p.y) }
    : null
}

/** Coerce one setting to a valid value, falling back to the default for anything malformed. */
export function normalise<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const d = SETTINGS_DEFAULTS
  switch (key) {
    case 'bubble':
    case 'merchantWindow':
    case 'detailsWindow':
    case 'panelPosition':
      return point(value) as Settings[K]
    case 'panel': {
      const v = (value ?? {}) as Partial<Settings['panel']>
      return { width: num(v.width, 900, 3840, d.panel.width), height: num(v.height, 600, 2160, d.panel.height) } as Settings[K]
    }
    case 'panelOnTop':
    case 'hideFromCapture':
    case 'hideMaxed':
    case 'sleepWithoutGame':
    case 'hideWhenGameAway':
      return bool(value, d[key] as boolean) as Settings[K]
    case 'hud': {
      const v = (value ?? {}) as Partial<Settings['hud']>
      return {
        enabled: bool(v.enabled, d.hud.enabled),
        position: point(v.position),
        // 'nearby' was a mode before it became its own section (0.1.3).
        mode: v.mode === 'pinned' ? 'pinned' : 'recent',
        nearby: bool(v.nearby, d.hud.nearby),
        nearbyCount: Math.round(num(v.nearbyCount, 1, 8, d.hud.nearbyCount)),
        pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter((n) => Number.isInteger(n)))].slice(0, 12) : [],
        recentCount: Math.round(num(v.recentCount, 1, 8, d.hud.recentCount)),
        toasts: bool(v.toasts, d.hud.toasts),
        opacity: num(v.opacity, 0.3, 1, d.hud.opacity),
        scale: num(v.scale, 0.75, 1.75, d.hud.scale),
        hideWithoutGame: bool(v.hideWithoutGame, d.hud.hideWithoutGame),
        idleHideSeconds: Math.round(num(v.idleHideSeconds, 0, 600, d.hud.idleHideSeconds)),
        merchant: bool(v.merchant, d.hud.merchant),
        kina: bool(v.kina, d.hud.kina),
        cubes: bool(v.cubes, d.hud.cubes),
        cubeSound: bool(v.cubeSound, d.hud.cubeSound),
      } as Settings[K]
    }
    case 'timers': {
      const v = (value ?? {}) as Partial<Settings['timers']>
      const on = (v.enabled ?? {}) as Partial<Record<TimerId, unknown>>
      const lead = (v.lead ?? {}) as Partial<Record<TimerId, unknown>>
      return {
        region: REGIONS.some((r) => r.id === v.region) ? v.region : d.timers.region,
        enabled: Object.fromEntries(TIMERS.map((t) => [t.id, bool(on[t.id], t.defaultOn)])) as Record<TimerId, boolean>,
        // One of the leads offered for that timer; anything else falls back to its default.
        lead: Object.fromEntries(
          TIMERS.map((t) => [t.id, leadChoices(t).includes(lead[t.id] as number) ? (lead[t.id] as number) : t.lead]),
        ) as Record<TimerId, number>,
        sound: bool(v.sound, d.timers.sound),
        volume: num(v.volume, 0, 1, d.timers.volume),
        shake: bool(v.shake, d.timers.shake),
        shown: Object.fromEntries(
          TIMERS.map((t) => [t.id, bool((v.shown as Partial<Record<TimerId, unknown>> | undefined)?.[t.id], defaultShown(t))]),
        ) as Record<TimerId, boolean>,
      } as Settings[K]
    }
    case 'minimap': {
      const v = (value ?? {}) as Partial<Settings['minimap']>
      return {
        enabled: bool(v.enabled, d.minimap.enabled),
        position: point(v.position),
        size: Math.round(num(v.size, 160, 520, d.minimap.size)),
        opacity: num(v.opacity, 0.3, 1, d.minimap.opacity),
        zoom: num(v.zoom, 1, 40, d.minimap.zoom),
      } as Settings[K]
    }
    case 'timerBar': {
      const v = (value ?? {}) as Partial<Settings['timerBar']>
      return {
        enabled: bool(v.enabled, d.timerBar.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0.3, 1, d.timerBar.opacity),
      } as Settings[K]
    }
    case 'killFeed': {
      const v = (value ?? {}) as Partial<Settings['killFeed']>
      return { open: bool(v.open, d.killFeed.open), position: point(v.position) } as Settings[K]
    }
    case 'skills': {
      const v = (value ?? {}) as Partial<Settings['skills']>
      return {
        enabled: bool(v.enabled, d.skills.enabled),
        position: point(v.position),
        rows: Math.round(num(v.rows, 1, 20, d.skills.rows)),
        opacity: num(v.opacity, 0.3, 1, d.skills.opacity),
      } as Settings[K]
    }
    case 'buffs': {
      const v = (value ?? {}) as Partial<Settings['buffs']>
      return {
        enabled: bool(v.enabled, d.buffs.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0.3, 1, d.buffs.opacity),
        size: Math.round(num(v.size, 22, 56, d.buffs.size)),
        perRow: Math.round(num(v.perRow, 4, 20, d.buffs.perRow)),
        debuffs: bool(v.debuffs, d.buffs.debuffs),
        passives: bool(v.passives, d.buffs.passives),
      } as Settings[K]
    }
    case 'meter': {
      const v = (value ?? {}) as Partial<Settings['meter']>
      return {
        enabled: bool(v.enabled, d.meter.enabled),
        position: point(v.position),
        targetMode: (TARGET_MODES as readonly unknown[]).includes(v.targetMode) ? v.targetMode : d.meter.targetMode,
        rows: Math.round(num(v.rows, 1, 24, d.meter.rows)),
        opacity: num(v.opacity, 0.3, 1, d.meter.opacity),
      } as Settings[K]
    }
    case 'faction':
      return (value === 'asmodians' ? 'asmodians' : 'elyos') as Settings[K]
    case 'playerLevel':
      return (typeof value === 'number' && Number.isFinite(value) ? Math.round(num(value, 1, 99, 1)) : null) as Settings[K]
    case 'lokthar': {
      const v = (value ?? {}) as Partial<Settings['lokthar']>
      return {
        sync: bool(v.sync, d.lokthar.sync),
        url: typeof v.url === 'string' && v.url.trim() ? v.url.trim().replace(/\/+$/, '') : d.lokthar.url,
        token: typeof v.token === 'string' ? v.token.trim() : '',
      } as Settings[K]
    }
    case 'tracker': {
      const v = (value ?? {}) as Partial<Settings['tracker']>
      return {
        dataFile: typeof v.dataFile === 'string' ? v.dataFile.trim() : '',
      } as Settings[K]
    }
  }
  return d[key]
}
