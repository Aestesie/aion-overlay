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

/** What is left, as the overlay shows it: "1:05", "42", "9.5"; empty when it never runs out. */
export function remaining(ms: number | null): string {
  if (ms === null) return ''
  const s = Math.max(0, ms) / 1000
  if (s < 10) return s.toFixed(1)
  if (s < 60) return String(Math.floor(s))
  if (s < 3600) return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return `${Math.floor(s / 3600)}h`
}
