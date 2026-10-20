<script setup lang="ts">
// History: the boss fights the engine saved (every 30 s while one goes on, and before the meter is
// cleared), newest first. A click opens one in the Details window: each player's damage, skills and
// buffs. The last 500 are kept.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Segmented from '@/components/ui/Segmented.vue'
import { bridge } from '@/lib/bridge.ts'
import { CLASS_NAMES, type FightSummary } from '@shared/meter.ts'

const api = bridge()
const fights = ref<FightSummary[] | null>(null)
const kind = ref<'bosses' | 'dummy' | 'all'>('bosses')
const query = ref('')

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

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (fights.value ?? []).filter(
    (f) => (kind.value === 'all' || (kind.value === 'dummy') === f.isTrain) && (!q || (f.bossName || '').toLowerCase().includes(q)),
  )
})
const KINDS = computed(() => [
  { id: 'bosses' as const, label: 'Bosses', count: (fights.value ?? []).filter((f) => !f.isTrain).length },
  { id: 'dummy' as const, label: 'Training dummy', count: (fights.value ?? []).filter((f) => f.isTrain).length },
  { id: 'all' as const, label: 'All', count: (fights.value ?? []).length },
])

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
  <div>
    <PageHeader title="History" about="Boss fights saved as you play, newest first. Open one for each player's damage, skills and buffs." />

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <Segmented v-model="kind" :options="KINDS" size="sm" />
      <input
        v-model="query"
        type="search"
        placeholder="Search by boss"
        class="ml-auto h-8 w-60 rounded-md border border-light bg-default px-2.5 text-sm placeholder:text-darkest focus:border-accent"
      />
    </div>

    <p v-if="fights === null" class="text-sm text-darker">Loading…</p>
    <div v-else-if="!shown.length" class="rounded-xl border border-dashed border-card px-4 py-10 text-center">
      <div class="text-sm font-medium">No fights {{ query ? 'match' : 'saved yet' }}.</div>
      <div class="mt-1 text-xs text-darker">Each boss fight is kept as it ends, and before the meter is cleared.</div>
    </div>
    <div v-else class="overflow-hidden rounded-xl border border-card">
      <table class="w-full text-sm">
        <thead class="bg-card text-xs uppercase tracking-wide text-darker">
          <tr class="border-b border-card">
            <th class="py-2.5 pl-4 text-left font-medium">Fight</th>
            <th class="px-3 text-left font-medium">Party</th>
            <th class="w-20 px-3 text-right font-medium">Time</th>
            <th class="w-24 px-3 text-right font-medium">Damage</th>
            <th class="w-24 px-3 text-right font-medium">DPS</th>
            <th class="w-36 px-3 text-left font-medium">When</th>
            <th class="w-12 pr-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--line)]">
          <tr v-for="f in shown" :key="f.id" class="group cursor-pointer hover:bg-card" @click="open(f.id)">
            <td class="py-2 pl-4">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ f.bossName || 'Unknown target' }}</span>
                <span v-if="f.isTrain" class="shrink-0 rounded border border-light px-1 text-[10px] text-darker">dummy</span>
              </div>
            </td>
            <td class="px-3">
              <div class="flex items-center gap-0.5">
                <template v-for="(job, i) in f.memberJobs" :key="i">
                  <img v-if="icon(job)" :src="icon(job)!" class="size-4" alt="" :title="CLASS_NAMES[job]" />
                </template>
              </div>
            </td>
            <td class="px-3 text-right tabular-nums text-darker">{{ clock(f.durationMs) }}</td>
            <td class="px-3 text-right tabular-nums">{{ short(f.totalDamage) }}</td>
            <td class="px-3 text-right tabular-nums text-darker">{{ short(f.totalDamage / Math.max(1, f.durationMs / 1000)) }}</td>
            <td class="px-3 text-xs text-darker">{{ when(f.startTimeMs) }}</td>
            <td class="pr-3 text-right">
              <button
                type="button"
                class="inline-flex size-7 items-center justify-center rounded-md text-darker opacity-0 hover:bg-light hover:text-danger group-hover:opacity-100"
                title="Delete this fight"
                @click.stop="remove(f.id)"
              >
                <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" /></svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
