<script setup lang="ts">
// The DPS meter, in a window of its own: open while the game is (and the meter is on), moved by its
// header, sized to its rows. The numbers are the engine's (A2Tools DPS Meter's parser); this page
// only draws them. The class icons and colours are A2Tools DPS Meter's too.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { CLASS_COLORS, NO_METER, TARGET_MODE_LABELS, TARGET_MODES, type MeterData, type TargetMode } from '@shared/meter.ts'
import type { TrackerState } from '@shared/tracker.ts'

const store = useApp()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.meter)
const api = bridge()

const meter = ref<MeterData>(NO_METER)
/** The engine's state: the meter and the tracker are the same process. */
const status = computed(() => store.status ?? { state: 'starting' as TrackerState, detail: null })

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null =>
  className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null

const rows = computed(() => meter.value.rows.slice(0, cfg.value.rows))
const top = computed(() => Math.max(1, ...meter.value.rows.map((r) => r.damage)))
const totalDps = computed(() => meter.value.rows.filter((r) => !r.others).reduce((n, r) => n + r.dps, 0))

/** 1234 → 1.2k, 1234567 → 1.23M */
function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const hpShare = computed(() => {
  const t = meter.value.target
  return t && t.maxHp > 0 && t.hp !== null ? Math.min(1, Math.max(0, t.hp / t.maxHp)) : null
})

const STATUS_TEXT: Record<TrackerState, string> = {
  starting: 'Starting…',
  listening: 'Looking for the game connection…',
  locked: 'Waiting for a fight',
  idle: 'Asleep until Aion 2 starts',
  stopped: 'Replay finished',
  error: 'Error',
  exited: 'Restarting…',
}
const statusDot = computed(
  () =>
    ({ locked: 'bg-green', listening: 'bg-yellow', starting: 'bg-yellow', exited: 'bg-yellow', error: 'bg-danger', idle: 'bg-darkest', stopped: 'bg-darkest' })[
      status.value.state
    ],
)

const drag = windowDrag({ move: 'meter:moveTo', end: 'meter:dragEnd' })
const reset = (): void => void api.invoke('meter:reset')
/** A row's skills, in the Details window: the live target's, following the fight. */
function showDetails(actor: number): void {
  const target = meter.value.target?.id
  if (target) void api.invoke('details:open', { kind: 'live', target, actor })
}
/** Your ping, coloured by how it plays: under 80 ms good, under 150 ms fair. */
const pingClass = computed(() => {
  const ms = meter.value.ping
  return ms === null ? '' : ms < 80 ? 'text-green' : ms < 150 ? 'text-yellow' : 'text-danger'
})
function setMode(e: Event): void {
  const targetMode = (e.target as HTMLSelectElement).value as TargetMode
  void api.invoke('settings:set', 'meter', { ...cfg.value, targetMode })
}

/** Tell main how big the window is. */
let sent = ''
function report(): void {
  const r = root.value?.getBoundingClientRect() ?? { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('meter:resize', { width: r.width, height: r.height })
}
watch([rows, () => meter.value.target, status, () => store.ready], () => void nextTick(report), { deep: true })

let observer: ResizeObserver | null = null
const offs: (() => void)[] = []
onMounted(async () => {
  offs.push(api.on('meter:dps', (m) => (meter.value = m)))
  meter.value = await api.invoke('meter:get')
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  for (const off of offs) off()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div class="m-1.5 w-[300px] rounded-lg border border-card bg-darker shadow-card" :style="{ opacity: cfg.opacity }">
        <header class="flex cursor-move items-center gap-2 border-b border-card px-2.5 py-1.5" title="Drag to move" @pointerdown="drag.onPointerDown">
          <span :class="['size-1.5 shrink-0 rounded-full', statusDot]" :title="status.detail ?? STATUS_TEXT[status.state]" />
          <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-dark">
            {{ meter.target?.name || 'DPS' }}
          </span>
          <span v-if="meter.battleTime" class="shrink-0 text-[11px] tabular-nums text-darker">{{ clock(meter.battleTime) }}</span>
          <select
            class="shrink-0 rounded border border-light bg-dark px-1 py-0.5 text-[10px] text-darker"
            title="Which target the meter follows"
            :value="cfg.targetMode"
            @pointerdown.stop
            @change="setMode"
          >
            <option v-for="m in TARGET_MODES" :key="m" :value="m">{{ TARGET_MODE_LABELS[m] }}</option>
          </select>
          <button
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
            title="Reset the meter"
            @pointerdown.stop
            @click="reset"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </header>

        <div v-if="hpShare !== null" class="px-2.5 pt-1.5">
          <div class="relative h-3 overflow-hidden rounded bg-dark">
            <div class="h-full bg-danger/70" :style="{ width: `${hpShare * 100}%` }" />
            <span class="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-default">
              {{ (hpShare * 100).toFixed(1) }}% · {{ short(meter.target!.hp!) }}
            </span>
          </div>
        </div>

        <ul v-if="rows.length" class="space-y-0.5 px-1.5 py-1.5">
          <li
            v-for="(r, i) in rows"
            :key="r.id"
            class="relative cursor-pointer overflow-hidden rounded hover:ring-1 hover:ring-light"
            :title="`${r.className ?? 'Unknown class'} · ${short(r.damage)} damage · click for skills`"
            @click="showDetails(r.id)"
          >
            <div
              class="absolute inset-y-0 left-0 opacity-30"
              :style="{ width: `${(r.damage / top) * 100}%`, background: CLASS_COLORS[r.className ?? ''] ?? '#787b8a' }"
            />
            <div class="relative flex items-center gap-1.5 px-1 py-0.5 text-[12px]">
              <span class="w-3 shrink-0 text-right text-[10px] tabular-nums text-darkest">{{ i + 1 }}</span>
              <img v-if="icon(r.className)" :src="icon(r.className)!" class="size-4 shrink-0" alt="" />
              <span v-else class="size-4 shrink-0" />
              <span :class="['min-w-0 flex-1 truncate', r.you ? 'font-semibold text-yellow' : 'text-dark']">{{ r.name }}</span>
              <span class="shrink-0 tabular-nums text-dark">{{ short(r.dps) }}</span>
              <span class="w-10 shrink-0 text-right text-[10px] tabular-nums text-darker">{{ r.share.toFixed(1) }}%</span>
            </div>
          </li>
        </ul>
        <p v-else class="px-2.5 py-2 text-[11px] text-darker">
          {{ status.state === 'error' || status.state === 'exited' ? status.detail : STATUS_TEXT[status.state] }}
        </p>

        <footer v-if="rows.length > 1 || meter.ping !== null" class="flex gap-2 border-t border-card px-2.5 py-1 text-[10px] tabular-nums text-darkest">
          <span>{{ TARGET_MODE_LABELS[meter.mode] }}</span>
          <span v-if="meter.ping !== null" class="ml-auto" title="Your ping to the game server">
            <span :class="pingClass">{{ meter.ping }}</span> ms
          </span>
          <span v-if="rows.length > 1" :class="meter.ping === null && 'ml-auto'">party {{ short(totalDps) }}/s</span>
        </footer>
      </div>
    </div>
  </div>
</template>
