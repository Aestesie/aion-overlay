/**
 * What the Event Alerts and Field Bosses pages share: each timer's icon, its next start (an
 * alerting one keeps the start it alerts for), and switching its alert, which also lists it (only
 * listed timers alert: shared/timers.ts).
 */
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { nextStart, type TimerDef, type TimerId } from '@shared/timers.ts'

/** Line icons for the events, 16x16 stroked paths (Lucide's shapes). */
export const EVENT_ICONS: Partial<Record<TimerId, string>> = {
  shugo: 'M8 2.5v2M4.5 4l1 1.5M11.5 4l-1 1.5M3 13.5l2.5-6 3 3zM9.5 8.5c1-1 2.5-1.5 4-1M10.5 11c.8-.3 2-.3 3 .2',
  merchant: 'M2.5 6.5 4 2.5h8l1.5 4M2.5 6.5h11M3.5 6.5v7h9v-7M6.5 13.5v-4h3v4',
  rift: 'M9 1.5 3.5 9h4l-1 5.5L12.5 7h-4z',
  invasion: 'M2.5 13.5 6 10M4 8l4 4M5.5 6.5l6-4 2 2-4 6M11 5l-1.5 1.5',
  kaira: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  siege: 'M3 14V5.5L5 4v2l2-1.5V6l2-1.5V6l2-1.5V14M6.5 14v-3h3v3M2 14h12',
  siegeBosses: 'M8 2a5 5 0 0 0-3.5 8.5V13h7v-2.5A5 5 0 0 0 8 2zM6 8.5h.01M10 8.5h.01M7 13v-1.5M9 13v-1.5',
  nahma: 'M2.5 12.5h11l1-7-3.5 3L8 3.5 5 8.5l-3.5-3zM2.5 14h11',
  dailyReset: 'M4 10.5a4 4 0 0 1 8 0M8 3v1.5M3 6.5l1 1M13 6.5l-1 1M1.5 10.5h1.5M13 10.5h1.5M2 13h12',
  weeklyReset: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3M6 10l1.5 1.5L10 9',
}
export const CLOCK_ICON = 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5'

/** The timer's start that matters now: the one it alerts for while alerting, else the next. */
export function timerNext(def: TimerDef, now: number): number {
  const store = useApp()
  return store.alerting.find((a) => a.id === def.id)?.at ?? nextStart(def.schedule, now, store.settings.timers.region, store.fieldBosses)
}

/** Turn a timer's alert on (listing it) or off. */
export function setAlert(id: TimerId, on: boolean): void {
  const store = useApp()
  const t = store.settings.timers
  void store.set('timers', {
    ...t,
    enabled: { ...t.enabled, [id]: on },
    shown: on ? { ...t.shown, [id]: true } : t.shown,
  })
}

export function setLead(id: TimerId, minutes: number): void {
  const store = useApp()
  const t = store.settings.timers
  void store.set('timers', { ...t, lead: { ...t.lead, [id]: minutes } })
}

/** "At start", "5 min before", "1 h before". */
export const leadLabel = (m: number): string => (m === 0 ? t('At start') : m < 60 ? t('{n} min before', { n: m }) : t('{n} h before', { n: m / 60 }))
