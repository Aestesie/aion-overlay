/**
 * A buff's name and icon, from its id: A2Tools DPS Meter's tables (src/shared/abnormals.json),
 * with the icons bundled in public/buffs (scripts/fetch-buff-icons.mjs). A buff without an icon
 * of its own shows the icon of the skill that applied it, as upstream does.
 */
import table from '@shared/abnormals.json'
import { skillIcon } from './skillIcons.ts'

const ABNORMALS = (table as unknown as { abnormals: Record<string, [string | null, string | null]> }).abnormals

export function buffName(id: number): string {
  return ABNORMALS[String(id)]?.[0] ?? `Buff ${id}`
}

/** The image to show: the buff's own, else its skill's; null for none (a dot is drawn). */
export function buffIcon(id: number, skill?: number | null): string | null {
  const icon = ABNORMALS[String(id)]?.[1]
  if (icon && /^[A-Za-z0-9_]+$/.test(icon)) return `buffs/${icon}.webp`
  if (skill) {
    const s = skillIcon(skill)
    if (s && s !== 'basic') return s
  }
  return null
}

/** Losing control of your character: what the CC / Debuffs panel announces. */
export type CcKind =
  | 'stun' | 'knockdown' | 'airborne' | 'root' | 'fear' | 'sleep' | 'silence' | 'frozen'
  | 'polymorph' | 'knockback' | 'pull' | 'charm' | 'blind' | 'petrify' | 'stagger'

export const CC_LABEL: Record<CcKind, string> = {
  stun: 'Stunned', knockdown: 'Knocked down', airborne: 'Airborne', root: 'Rooted', fear: 'Feared', sleep: 'Asleep',
  silence: 'Silenced', frozen: 'Frozen', polymorph: 'Transformed', knockback: 'Knocked back', pull: 'Pulled',
  charm: 'Charmed', blind: 'Blinded', petrify: 'Petrified', stagger: 'Staggered',
}

/**
 * The game's own type for an effect: the type icon its buff table gives it (ICON_Abnormal_Stun is
 * every stun, ICON_Abnormal_HOLD every root...), checked against the names of all 4,000.
 */
const CC_ICONS: Record<string, CcKind> = {
  ICON_Abnormal_Stun: 'stun',
  ICON_Abnormal_Knockdown: 'knockdown',
  ICON_Abnormal_Stumble: 'knockdown',
  ICON_Abnormal_Airborne: 'airborne',
  ICON_Abnormal_HOLD: 'root',
  ICON_Abnormal_Bind: 'root',
  ICON_Common_Abnormal_Entangle: 'root',
  ICON_Abnormal_Fear: 'fear',
  ICON_Abnormal_Sleep: 'sleep',
  ICON_Abnormal_Silence: 'silence',
  ICON_Abnormal_Frozen: 'frozen',
  ICON_Abnormal_Polymorph: 'polymorph',
  ICON_Abnormal_Move: 'knockback',
  ICON_Abnormal_Charming: 'charm',
  ICON_Abnormal_Blind: 'blind',
  ICON_Common_Abnormal_Stone: 'petrify',
  ICON_Cond_Groggy: 'stagger',
}
/** The ones whose icon is a skill's: by name. */
const CC_NAMES: [RegExp, CcKind][] = [
  [/^(stun|paraly[sz]e)\b/i, 'stun'],
  [/^knockdown\b/i, 'knockdown'],
  [/^(knock ?back|push)\b/i, 'knockback'],
  [/^(pull|pulled)\b/i, 'pull'],
  [/^airborne\b|aerial bind/i, 'airborne'],
  [/^root\b/i, 'root'],
  [/petrif/i, 'petrify'],
  [/^stagger$/i, 'stagger'],
  [/(^|: )fear$/i, 'fear'],
  [/^sleep$/i, 'sleep'],
  [/^silence$|'s silence$/i, 'silence'],
  [/soul freeze/i, 'frozen'],
]

/** The kind of loss of control an effect is, or null for anything else. */
export function ccKind(id: number): CcKind | null {
  const [name, icon] = ABNORMALS[String(id)] ?? [null, null]
  if (icon && CC_ICONS[icon]) return CC_ICONS[icon]
  if (name) for (const [re, kind] of CC_NAMES) if (re.test(name)) return kind
  return null
}

/** What is left, as the overlay shows it: "1:05", "42", "9.5"; empty when it never runs out. */
export function remaining(ms: number | null): string {
  if (ms === null) return ''
  const s = Math.max(0, ms) / 1000
  if (s < 10) return s.toFixed(1)
  if (s < 60) return String(Math.floor(s))
  if (s < 3600) return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return `${Math.floor(s / 3600)}h`
}
