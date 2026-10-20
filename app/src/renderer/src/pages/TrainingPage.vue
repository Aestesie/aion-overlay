<script setup lang="ts">
// The Training overlay (questlog.gg's): a training dummy run over the game. Its name, its clock
// large (counting down to the time limit, or up), your DPS, and Stop and save or Cancel; between
// runs, Start and how the last one went. It shows while you train (a run, or a dummy hit in the last
// two minutes) and while the dashboard is up, to be placed; moved by its header.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { NO_DUMMY, nextRunName, type DummyState } from '@shared/dummy.ts'

const SHOW_AFTER_HIT_MS = 120_000

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.dummy)
const state = ref<DummyState>(structuredClone(NO_DUMMY))
const now = ref(Date.now())

function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const active = computed(() => state.value.active)
const elapsed = computed(() => (active.value?.startedAt ? Math.max(active.value.elapsedMs, now.value - active.value.startedAt) : 0))
/** Down to the time limit, else up. */
const shownTime = computed(() => {
  const a = active.value
  if (a?.goal === 'time' && a.limitMs) return clock(a.limitMs - elapsed.value)
  return clock(elapsed.value)
})
const progress = computed(() => {
  const a = active.value
  if (!a) return 0
  if (a.goal === 'time') return a.limitMs ? Math.min(1, elapsed.value / a.limitMs) : 0
  return a.damageGoal ? Math.min(1, a.damage / a.damageGoal) : 0
})
const last = computed(() => state.value.runs[0] ?? null)
const planText = computed(() => {
  const goal = cfg.value.goal === 'time' ? (cfg.value.limitMs ? `${clock(cfg.value.limitMs)} run` : 'Untimed run') : `${short(cfg.value.damageGoal)} damage`
  return `${goal} · ${cfg.value.autoStart ? 'starts on your first hit' : 'starts when you press Start'}`
})
const shown = computed(
  () => !!active.value || store.panelVisible || (state.value.lastHitAt !== null && now.value - state.value.lastHitAt < SHOW_AFTER_HIT_MS),
)

const drag = windowDrag({ move: 'training:moveTo', end: 'training:dragEnd' })

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && shown.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('training:resize', { width: r.width, height: r.height })
}
watch([shown, active, last], () => void nextTick(report))

let timer: ReturnType<typeof setInterval> | null = null
let observer: ResizeObserver | null = null
let off: (() => void) | null = null
onMounted(async () => {
  off = api.on('dummy:state', (s) => (state.value = s))
  state.value = await api.invoke('dummy:get')
  timer = setInterval(() => (now.value = Date.now()), 250)
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  observer?.disconnect()
  off?.()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div v-if="shown" class="m-1.5 w-[280px] rounded-xl border border-card bg-darker/95 shadow-card">
        <header class="flex cursor-move items-center gap-2 px-3.5 pb-1 pt-3" title="Drag to move" @pointerdown="drag.onPointerDown">
          <span class="text-base font-semibold">Training</span>
          <span v-if="active?.startedAt" class="size-2 animate-pulse rounded-full bg-danger" />
        </header>

        <template v-if="active">
          <div class="truncate px-3.5 text-center text-sm text-dark">{{ active.name }}</div>
          <div class="text-center text-5xl font-bold tabular-nums leading-tight">{{ shownTime }}</div>
          <div v-if="!active.startedAt" class="px-3.5 text-center text-xs text-darker">Hit the dummy: the clock starts with your first hit.</div>
          <div class="relative mx-3 mt-2 flex h-9 items-center overflow-hidden rounded-lg bg-dark px-3">
            <div class="absolute inset-y-0 left-0 bg-accent/30" :style="{ width: `${progress * 100}%` }" />
            <span class="relative text-sm text-dark">DPS</span>
            <span class="relative ml-auto text-base font-semibold tabular-nums text-accent">{{ short(active.dps) }}</span>
          </div>
          <div class="flex gap-2 p-3">
            <button
              type="button"
              class="h-9 flex-1 rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              :disabled="!active.startedAt"
              @click="api.invoke('dummy:stop', true)"
            >Stop and save</button>
            <button type="button" class="h-9 rounded-lg px-3 text-sm text-dark hover:bg-dark" @click="api.invoke('dummy:stop', false)">Cancel</button>
          </div>
        </template>

        <template v-else>
          <div class="px-3.5 text-xs text-darker">{{ planText }}</div>
          <div v-if="last" class="mx-3 mt-2 rounded-lg bg-dark px-3 py-2 text-xs">
            <div class="text-darker">Last: {{ last.name }}</div>
            <div class="flex items-baseline gap-2">
              <span class="text-lg font-semibold tabular-nums text-accent">{{ short(last.dps) }}</span><span class="text-darker">DPS</span>
              <span class="ml-auto tabular-nums text-darker">{{ short(last.damage) }} · {{ clock(last.durationMs) }}</span>
            </div>
          </div>
          <div class="p-3">
            <button type="button" class="h-9 w-full rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-hover" @click="api.invoke('dummy:start')">
              Start {{ nextRunName(state) }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
