<script setup lang="ts">
// The timers as a bar over the game: each timer with its alert on (the Timers tab) that starts
// within the next 13 hours, soonest first, as its icon and a countdown. Events have their own icon
// (the rift's stands for the invasion and the siege too), field bosses their portrait, the rest a
// short name. Moved by dragging; sized to what it shows, and hidden with nothing to show.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { nextStart, TIMERS, type TimerDef, type TimerId } from '@shared/timers.ts'

/** Starts further away than this are left off the bar. */
const HORIZON_MS = 13 * 3600_000

const store = useApp()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.timers)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)

const ICONS: Partial<Record<TimerId, string>> = {
  shugo: 'events/shugo.webp',
  rift: 'events/rift.webp',
  invasion: 'events/rift.webp',
  siege: 'events/rift.webp',
  siegeBosses: 'events/rift.webp',
}
const LABELS: Partial<Record<TimerId, string>> = {
  kaira: 'Kaira',
  nahma: 'Nahma',
  merchant: 'Merchant',
  dailyReset: 'Daily',
  weeklyReset: 'Weekly',
}
const icon = (def: TimerDef): string | null =>
  def.schedule.kind === 'boss' ? `bosses/${def.schedule.boss}.webp` : (ICONS[def.id] ?? null)

const alerting = computed(() => new Map(store.alerting.map((a) => [a.id, a.at])))

/** The timers to show: alert on, starting within the horizon (or alerting now), soonest first. */
const items = computed(() =>
  TIMERS.filter((def) => cfg.value.enabled[def.id] && cfg.value.shown[def.id])
    .map((def) => ({
      def,
      at: alerting.value.get(def.id) ?? nextStart(def.schedule, now.value, cfg.value.region, store.fieldBosses),
    }))
    .filter(({ at }) => Number.isFinite(at) && at - now.value <= HORIZON_MS)
    .sort((a, b) => a.at - b.at),
)

/** 48:09, 1:48:09; "now" once it has started. */
function countdown(at: number): string {
  const s = Math.ceil((at - now.value) / 1000)
  if (s <= 0) return 'now'
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const drag = windowDrag({ move: 'timerbar:moveTo', end: 'timerbar:dragEnd' })

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && items.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void bridge().invoke('timerbar:resize', { width: r.width, height: r.height })
}
watch([() => items.value.length, () => store.ready], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div
        v-if="items.length"
        class="m-1.5 flex cursor-move items-center gap-1.5 rounded-lg border border-card bg-darker/90 px-1.5 py-1 shadow-card"
        title="Drag to move"
        @pointerdown="drag.onPointerDown"
      >
        <div
          v-for="{ def, at } in items"
          :key="def.id"
          :class="['flex items-center gap-1.5 rounded-md px-1.5 py-0.5', alerting.has(def.id) ? 'bg-yellow/15' : 'bg-dark']"
          :title="`${def.name}: ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`"
        >
          <img v-if="icon(def)" :src="icon(def)!" class="size-5 rounded-sm object-cover" alt="" draggable="false" />
          <span v-else class="text-[12px] font-semibold text-dark">{{ LABELS[def.id] ?? def.name }}</span>
          <span v-if="alerting.has(def.id)" class="size-1.5 rounded-full bg-yellow" />
          <span class="text-[12px] font-semibold tabular-nums text-default">{{ countdown(at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
