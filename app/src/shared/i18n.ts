/**
 * The app in English or Spanish (Settings → language, Spanish by default). Text is written in
 * English where it is used and looked up here: `ES` holds its Spanish, and a line not in it stays
 * English. The Spanish is the community's: game words players use as they are (PvP, DPS, skill,
 * buff, bosses, pets, Training Dummy, Hidden Cubes, kill, assist...) are left in English, the app's
 * own words are translated.
 *
 * `{name}` in a line is filled from `vars`. `npm run i18n:check` lists lines used without Spanish.
 */
import { ES } from './i18n.es.ts'

export type Lang = 'es' | 'en'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
]

export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const line = lang === 'es' ? (ES[text] ?? text) : text
  return vars ? line.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all)) : line
}

/** Dates and times written the language's way. */
export function locale(lang: Lang): string {
  return lang === 'es' ? 'es-ES' : 'en-US'
}
