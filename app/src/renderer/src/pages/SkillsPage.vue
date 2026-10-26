<script setup lang="ts">
// Your own damage on the meter's target, skill by skill: your DPS large, then each skill's icon,
// DPS, share and damage, a bar behind each as long as its share. Redrawn every second; moved by its
// header, sized to its rows (hidden while none of your damage is on the target).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SkillIcon from '@/components/SkillIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { NO_PERSONAL, type PersonalView } from '@shared/meter.ts'

const EVERY_MS = 1000

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.skills)
const view = ref<PersonalView>(NO_PERSONAL)

const rows = computed(() => view.value.skills.slice(0, cfg.value.rows))
const top = computed(() => Math.max(1, ...view.value.skills.map((s) => s.damage)))

function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function load(): Promise<void> {
  view.value = await api.invoke('skills:get')
}

const drag = windowDrag({ move: 'skills:moveTo', end: 'skills:dragEnd' })

/** Tell main how big the window is; nothing of yours measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && rows.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('skills:resize', { width: r.width, height: r.height })
}
watch(() => rows.value.length, () => void nextTick(report))

let timer: ReturnType<typeof setInterval> | null = null
let observer: ResizeObserver | null = null
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), EVERY_MS)
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div v-if="rows.length" class="m-1.5 w-[300px] rounded-lg border border-card bg-darker shadow-card" :style="{ opacity: cfg.opacity }">
        <header class="cursor-move px-2.5 pb-1.5 pt-2" :title="t('Drag to move')" @pointerdown="drag.onPointerDown">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-darker">
            <span>{{ t('My skills') }}</span>
            <span class="tabular-nums text-default">{{ clock(view.battleTime) }}</span>
            <span class="ml-auto truncate normal-case tracking-normal text-darkest">{{ view.target }}</span>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl font-semibold tabular-nums text-accent-text">{{ short(view.dps) }}</span>
            <span class="text-xs text-darker">DPS</span>
            <span class="ml-auto text-xs tabular-nums text-darker">{{ t('{n} damage', { n: short(view.damage) }) }}</span>
          </div>
        </header>
        <ul class="space-y-0.5 px-1.5 pb-1.5">
          <li v-for="s in rows" :key="`${s.code}-${s.dot}`" class="relative overflow-hidden rounded bg-dark">
            <div class="absolute inset-y-0 left-0 bg-accent/35" :style="{ width: `${(s.damage / top) * 100}%` }" />
            <div class="relative flex items-center gap-2 px-1 py-0.5 text-xs">
              <SkillIcon :code="s.code" :size="20" />
              <span class="min-w-0 flex-1 truncate font-medium text-default" :title="s.name">
                {{ s.name }}<span v-if="s.dot" class="ml-1 text-[10px] text-darker">DoT</span>
              </span>
              <span class="w-12 shrink-0 text-right font-semibold tabular-nums text-default">{{ short(s.dps) }}</span>
              <span class="w-11 shrink-0 text-right tabular-nums text-darker">{{ s.share.toFixed(1) }}%</span>
              <span class="w-12 shrink-0 text-right tabular-nums text-darker">{{ short(s.damage) }}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
