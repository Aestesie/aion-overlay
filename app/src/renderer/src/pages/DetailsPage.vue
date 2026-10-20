<script setup lang="ts">
// A fight's breakdown: every player's damage (and healing), and the chosen player's skills, from
// A2Tools DPS Meter's parser. Opened on the live target from a meter row (it follows the fight,
// redrawn every second), or on a saved fight from the History tab. Moved by its header; its X
// closes it.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SkillIcon from '@/components/SkillIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { CLASS_COLORS, type DetailsSkill, type DetailsView } from '@shared/meter.ts'

const LIVE_EVERY_MS = 1000

const api = bridge()
const view = ref<DetailsView | null>(null)
const loading = ref(true)
/** The player whose skills are listed; the one asked for, else the top one. */
const chosen = ref<number | null>(null)
const tab = ref<'damage' | 'healing'>('damage')

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null =>
  className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null

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
const pct = (n: number, of: number): string => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : '-')

const live = computed(() => view.value?.source.kind === 'live')
const actor = computed(() => view.value?.actors.find((a) => a.id === chosen.value) ?? view.value?.actors[0] ?? null)
const top = computed(() => Math.max(1, ...(view.value?.actors.map((a) => (tab.value === 'damage' ? a.damage : a.heal)) ?? [])))
const listed = computed(() => (view.value?.actors ?? []).filter((a) => (tab.value === 'damage' ? a.damage : a.heal) > 0))
const skills = computed<DetailsSkill[]>(() => {
  const all = tab.value === 'damage' ? view.value?.skills : view.value?.heals
  return (all ?? []).filter((s) => s.actor === actor.value?.id)
})
const skillTotal = computed(() => skills.value.reduce((n, s) => n + s.damage, 0))
const started = computed(() =>
  view.value?.startedAt ? new Date(view.value.startedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null,
)

async function load(): Promise<void> {
  const next = await api.invoke('details:get')
  loading.value = false
  if (!next) return
  const first = view.value === null || JSON.stringify(view.value.source) !== JSON.stringify(next.source)
  view.value = next
  if (first) chosen.value = next.source.actor ?? next.actors[0]?.id ?? null
}

const drag = windowDrag({ move: 'details:moveTo', end: 'details:dragEnd' })
const close = (): void => void api.invoke('details:close')

let timer: ReturnType<typeof setInterval> | null = null
let off: (() => void) | null = null
onMounted(() => {
  void load()
  off = api.on('details:source', () => {
    view.value = null
    loading.value = true
    void load()
  })
  // A live fight goes on: redrawn while the window is open.
  timer = setInterval(() => live.value && void load(), LIVE_EVERY_MS)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  off?.()
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden rounded-lg border border-card bg-darker shadow-card">
    <header class="flex cursor-move items-center gap-2 border-b border-card px-3 py-2" title="Drag to move" @pointerdown="drag.onPointerDown">
      <span v-if="live" class="size-1.5 shrink-0 rounded-full bg-green" title="Live: follows the fight" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-dark">{{ view?.title ?? 'Details' }}</div>
        <div v-if="view" class="text-[11px] tabular-nums text-darker">
          {{ clock(view.battleTime) }} · {{ short(view.totalDamage) }} damage<template v-if="view.maxHp"> of {{ short(view.maxHp) }} HP</template
          ><template v-if="started"> · {{ started }}</template>
        </div>
      </div>
      <button
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
        title="Close"
        @pointerdown.stop
        @click="close"
      >
        <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <p v-if="!view" class="px-3 py-4 text-xs text-darker">{{ loading ? 'Loading…' : 'Nothing to show: the fight is gone, or the engine is not running.' }}</p>

    <template v-else>
      <div class="flex gap-1 px-3 pt-2 text-[11px]">
        <button
          v-for="t in ['damage', 'healing'] as const"
          :key="t"
          type="button"
          :class="['rounded-full border px-2.5 py-0.5 capitalize', tab === t ? 'border-accent bg-accent/15 text-default' : 'border-light text-darker hover:text-dark']"
          @click="tab = t"
        >
          {{ t }}
        </button>
      </div>

      <ul class="space-y-0.5 px-2 py-2">
        <li
          v-for="a in listed"
          :key="a.id"
          :class="['relative cursor-pointer overflow-hidden rounded', a.id === actor?.id ? 'ring-1 ring-accent' : 'hover:bg-dark']"
          @click="chosen = a.id"
        >
          <div
            class="absolute inset-y-0 left-0 opacity-30"
            :style="{ width: `${((tab === 'damage' ? a.damage : a.heal) / top) * 100}%`, background: CLASS_COLORS[a.className ?? ''] ?? '#787b8a' }"
          />
          <div class="relative flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
            <img v-if="icon(a.className)" :src="icon(a.className)!" class="size-4 shrink-0" alt="" />
            <span v-else class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-dark">{{ a.name }}</span>
            <template v-if="tab === 'damage'">
              <span class="shrink-0 tabular-nums text-dark">{{ short(a.dps) }}/s</span>
              <span class="w-14 shrink-0 text-right tabular-nums text-darker">{{ short(a.damage) }}</span>
              <span class="w-11 shrink-0 text-right text-[10px] tabular-nums text-darker">{{ a.share.toFixed(1) }}%</span>
            </template>
            <span v-else class="shrink-0 tabular-nums text-dark">{{ short(a.heal) }}</span>
          </div>
        </li>
      </ul>

      <div class="min-h-0 flex-1 overflow-y-auto border-t border-card">
        <table class="w-full text-[11px] tabular-nums">
          <thead class="sticky top-0 bg-darker text-darkest">
            <tr>
              <th class="px-3 py-1 text-left font-medium">{{ actor?.name ?? '' }}: skill</th>
              <th class="px-1 py-1 text-right font-medium">{{ tab === 'damage' ? 'Damage' : 'Healed' }}</th>
              <th class="px-1 py-1 text-right font-medium">%</th>
              <th class="px-1 py-1 text-right font-medium">Hits</th>
              <th v-if="tab === 'damage'" class="px-1 py-1 text-right font-medium">Crit</th>
              <th v-if="tab === 'damage'" class="py-1 pl-1 pr-3 text-right font-medium">Max</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in skills" :key="`${s.code}-${s.dot}`" class="border-t border-card/60">
              <td class="max-w-0 px-3 py-1 text-dark" :title="s.name">
                <span class="flex min-w-0 items-center gap-1.5">
                  <SkillIcon :code="s.code" :size="16" />
                  <span class="truncate">{{ s.name }}</span><span v-if="s.dot" class="text-darkest">DoT</span>
                </span>
              </td>
              <td class="px-1 py-1 text-right text-default">{{ short(s.damage) }}</td>
              <td class="px-1 py-1 text-right text-darker">{{ pct(s.damage, skillTotal) }}</td>
              <td class="px-1 py-1 text-right text-darker">{{ s.hits }}</td>
              <td v-if="tab === 'damage'" class="px-1 py-1 text-right text-darker">{{ pct(s.crits, s.hits) }}</td>
              <td v-if="tab === 'damage'" class="py-1 pl-1 pr-3 text-right text-darker">{{ s.maxHit ? short(s.maxHit) : '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!skills.length" class="px-3 py-3 text-xs text-darker">No {{ tab }} by this player in this fight.</p>
      </div>
    </template>
  </div>
</template>
