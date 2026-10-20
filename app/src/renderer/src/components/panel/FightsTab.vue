<script setup lang="ts">
// The boss fights the engine saved (every 30 s while one goes on, and before the meter is cleared:
// a zone change, a reset), newest first. Click one for its breakdown in the Details window; the
// last 500 are kept.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { CLASS_NAMES, type FightSummary } from '@shared/meter.ts'

const api = bridge()
const fights = ref<FightSummary[] | null>(null)
const showTraining = ref(false)

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (job: string): string | null => {
  const name = CLASS_NAMES[job]
  return name ? (icons[`/src/assets/classes/${name.toLowerCase()}.png`] ?? null) : null
}

function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const when = (ms: number): string => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const shown = computed(() => (fights.value ?? []).filter((f) => showTraining.value || !f.isTrain))

async function load(): Promise<void> {
  fights.value = await api.invoke('history:list')
}
const open = (id: string): void => void api.invoke('details:open', { kind: 'saved', id })
function remove(id: string): void {
  void api.invoke('history:delete', id)
  fights.value = (fights.value ?? []).filter((f) => f.id !== id)
}

let off: (() => void) | null = null
onMounted(() => {
  void load()
  off = api.on('history:changed', () => void load())
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div class="space-y-3 p-3">
    <div class="flex items-center gap-2 text-xs">
      <span class="text-darker">Boss fights, saved as you play: click one for each player's skills.</span>
      <label class="ml-auto flex shrink-0 items-center gap-1.5 text-darker">
        <input v-model="showTraining" type="checkbox" class="accent-[color:var(--violet-9)]" />
        Training dummies
      </label>
    </div>

    <p v-if="fights === null" class="text-sm text-darker">Loading…</p>
    <p v-else-if="!shown.length" class="rounded-lg border border-card bg-card px-3 py-6 text-center text-sm text-darker">
      No boss fights saved yet. Each one is kept as it ends, and before the meter is cleared.
    </p>
    <ul v-else class="divide-y divide-[color:var(--gray-4)] overflow-hidden rounded-lg border border-card bg-card">
      <li
        v-for="f in shown"
        :key="f.id"
        class="group flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-dark"
        :title="`${f.bossName}: open its breakdown`"
        @click="open(f.id)"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-sm font-medium">{{ f.bossName || 'Unknown target' }}</span>
            <span v-if="f.isTrain" class="shrink-0 rounded border border-light px-1 text-[10px] text-darker">dummy</span>
          </div>
          <div class="flex items-center gap-1.5 text-[11px] tabular-nums text-darker">
            <span>{{ when(f.startTimeMs) }}</span>
            <span>· {{ clock(f.durationMs) }}</span>
            <span>· {{ short(f.totalDamage) }}</span>
            <span class="ml-1 flex items-center gap-0.5">
              <template v-for="(job, i) in f.memberJobs" :key="i">
                <img v-if="icon(job)" :src="icon(job)!" class="size-3.5" alt="" :title="CLASS_NAMES[job]" />
              </template>
            </span>
          </div>
        </div>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded text-darker opacity-0 hover:bg-light hover:text-danger group-hover:opacity-100"
          title="Delete this fight"
          @click.stop="remove(f.id)"
        >
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>
