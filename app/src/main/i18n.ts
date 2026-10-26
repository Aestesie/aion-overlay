/** Main's own text (the tray menu, dialogs, window titles) in the language picked (shared/i18n.ts). */
import { translate } from '../shared/i18n.ts'
import { settings } from './settings.ts'

export function tr(text: string, vars?: Record<string, string | number>): string {
  return translate(settings.get('language'), text, vars)
}
