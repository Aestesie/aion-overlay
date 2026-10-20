<script setup lang="ts">
// Field Bosses: each one's state as your map last listed it (alive, or how long until it
// respawns), when that was, and its alert. The list comes from the game when you open the map; the
// Lokthar sync can fill in what others' maps saw. Only Verteron's bosses are known so far.
import { computed, onBeforeUnmount, ref } from 'vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { leadLabel, setAlert, setLead } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import { FIELD_BOSSES, leadChoices, TIMERS, type TimerDef } from '@shared/timers.ts'

const store = useApp()
const cfg = computed(() => store.settings.timers)
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(ticker))

const ZONES = [{ id: 'verteron', label: 'Verteron' }] as const
const zone = ref<(typeof ZONES)[number]['id']>('verteron')

function ago(ms: number): string {
  const s = Math.max(0, Math.round((now.value - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Alive first, then by respawn, the ones never seen last. */
const rows = computed(() =>
  FIELD_BOSSES.map((b) => {
    const def = TIMERS.find((t) => t.schedule.kind === 'boss' && t.schedule.boss === b.boss) as TimerDef
    const state = store.fieldBosses[b.boss] ?? null
    const rank = !state ? 3 : state.up ? 0 : state.at < now.value ? 1 : 2
    return { ...b, def, state, rank }
  }).sort((a, b) => a.rank - b.rank || (a.state?.at ?? 0) - (b.state?.at ?? 0) || a.name.localeCompare(b.name)),
)
const alive = computed(() => rows.value.filter((r) => r.state?.up).length)
const on = (def: TimerDef): boolean => (cfg.value.enabled[def.id] ?? false) && (cfg.value.shown[def.id] ?? false)
</script>

<template>
  <div>
    <PageHeader title="Field Bosses" about="When each field boss is up or respawns, from the game's own list: open the map in game to update it. Turn on an alert to hear when one is due." />

    <div class="mb-4 flex items-center gap-4 border-b border-card">
      <button
        v-for="z in ZONES"
        :key="z.id"
        type="button"
        :class="['-mb-px border-b-2 px-1 pb-2 text-sm font-medium', zone === z.id ? 'border-accent text-default' : 'border-transparent text-darker hover:text-default']"
        @click="zone = z.id"
      >
        {{ z.label }}
      </button>
      <span class="pb-2 text-xs text-darkest">Other zones' bosses are not known yet.</span>
      <span class="ml-auto pb-2 text-xs text-darker"><span class="font-semibold text-green">{{ alive }}</span> alive</span>
    </div>

    <div class="overflow-hidden rounded-xl border border-card">
      <table class="w-full text-sm">
        <thead class="bg-card text-xs uppercase tracking-wide text-darker">
          <tr class="border-b border-card">
            <th class="py-2.5 pl-4 text-left font-medium">Boss</th>
            <th class="w-40 px-3 text-left font-medium">Status</th>
            <th class="w-36 px-3 text-left font-medium">Last read</th>
            <th class="w-44 px-3 text-left font-medium">Alert me</th>
            <th class="w-20 pr-4 text-right font-medium">Alert</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--line)]">
          <tr v-for="r in rows" :key="r.boss" class="hover:bg-card">
            <td class="py-2 pl-4">
              <div class="flex items-center gap-3">
                <img :src="`bosses/${r.boss}.webp`" alt="" loading="lazy" draggable="false" class="size-9 shrink-0 rounded-lg border border-card object-cover" />
                <span class="font-medium">{{ r.name }}</span>
              </div>
            </td>
            <td class="px-3">
              <span v-if="!r.state" class="text-darkest">Not seen</span>
              <span v-else-if="r.state.up" class="font-medium text-green">Alive</span>
              <span v-else-if="r.state.at <= now" class="text-yellow" :title="`Due since ${time(r.state.at)}`">Due</span>
              <span v-else class="font-medium text-yellow" :title="`Respawns at ${time(r.state.at)}`"><Countdown :at="r.state.at" :now="now" /></span>
            </td>
            <td class="px-3 text-xs text-darker">
              <template v-if="r.state">{{ ago(r.state.seen) }}<span v-if="r.state.source === 'shared'" class="text-darkest"> · shared</span></template>
            </td>
            <td class="px-3">
              <SelectBox
                v-if="on(r.def)"
                size="sm"
                :model-value="cfg.lead[r.def.id] ?? 0"
                :options="leadChoices(r.def).map((m) => ({ id: m, label: leadLabel(m) }))"
                @update:model-value="setLead(r.def.id, $event)"
              />
            </td>
            <td class="pr-4 text-right">
              <Toggle :model-value="on(r.def)" @update:model-value="setAlert(r.def.id, $event)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
