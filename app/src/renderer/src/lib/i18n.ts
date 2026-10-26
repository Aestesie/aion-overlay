/**
 * The windows' text in the language picked (shared/i18n.ts): `t('Settings')`. It reads the
 * setting from the store, so a page shows the other language as soon as it changes.
 */
import { useApp } from '@/stores/app.ts'
import { locale, translate, type Lang } from '@shared/i18n.ts'

export function lang(): Lang {
  return useApp().settings.language
}

export function t(text: string, vars?: Record<string, string | number>): string {
  return translate(lang(), text, vars)
}

/** One thing or several: `plural(n, '{n} pet', '{n} pets')`, with `{n}` filled in. */
export function plural(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars })
}

/** The locale for dates and times in the language picked (numbers stay as the game writes them: 123,186, 1.2K). */
export function loc(): string {
  return locale(lang())
}
