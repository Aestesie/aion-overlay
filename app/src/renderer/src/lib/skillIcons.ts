/**
 * A skill's icon, from its code: A2Tools DPS Meter's rules (public/src/js/skillIcons.js), with the
 * icons bundled in public/skills (scripts/fetch-skill-icons.mjs) instead of loaded from the game's
 * CDN. Codes are eight digits: the first two the class (11 Gladiator ... 19 Brawler), the first
 * four the skill.
 */
import table from '@shared/skillIcons.json'

const ICONS = table as Record<string, string>

/** The icon to show: a bundled image's path, 'basic' for a basic attack, or null for none known. */
export function skillIcon(code: number): string | 'basic' | null {
  const digits = String(code).replace(/\D/g, '')
  if (!digits) return 'basic'
  const c = digits.length >= 8 ? digits.slice(0, 8) : digits.padEnd(8, '0')
  // Basic attacks: a class's xx0000xx (not xx000000), the Spiritmaster's 1000xxxx, spirits' 1699xxxx.
  const prefix = c.slice(0, 2)
  if ((prefix >= '11' && prefix <= '18' && c.slice(2, 6) === '0000' && c.slice(6) !== '00') || c.startsWith('1000') || c.startsWith('1699')) {
    return 'basic'
  }
  const icon = ICONS[c.slice(0, 4)]
  return icon ? `skills/${icon}.webp` : null
}
