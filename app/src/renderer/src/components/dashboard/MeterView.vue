<script setup lang="ts">
// Combat Meter: the fight as the meter overlay sees it, larger, from A2Tools DPS Meter's parser.
// Which target it follows, each player's DPS and share (a click opens their skills in the Details
// window), and the settings of the meter and My skills overlays.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import Segmented from '@/components/ui/Segmented.vue'
import { bridge } from '@/lib/bridge.ts'
import { useApp } from '@/stores/app.ts'
import { CLASS_COLORS, NO_METER, TARGET_MODE_LABELS, TARGET_MODES, type MeterData, type TargetMode } from '@shared/meter.ts'

const store = useApp()
const api = bridge()
const meter = ref<MeterData>(NO_METER)
const cfg = computed(() => store.settings.meter)
const skills = computed(() => store.settings.skills)

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null => (className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null)

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
const top = computed(() => Math.max(1, ...meter.value.rows.map((r) => r.damage)))
const party = computed(() => meter.value.rows.filter((r) => !r.others).reduce((n, r) => n + r.dps, 0))
const hp = computed(() => {
  const t = meter.value.target
  return t && t.maxHp > 0 && t.hp !== null ? Math.min(1, Math.max(0, t.hp / t.maxHp)) : null
})
const pingClass = computed(() => {
  const ms = meter.value.ping
  return ms === null ? 'text-darker' : ms < 80 ? 'text-green' : ms < 150 ? 'text-yellow' : 'text-danger'
})

const MODES = TARGET_MODES.map((id) => ({ id, label: TARGET_MODE_LABELS[id] }))
const setMeter = (patch: Partial<typeof cfg.value>): void => void store.set('meter', { ...cfg.value, ...patch })
const setSkills = (patch: Partial<typeof skills.value>): void => void store.set('skills', { ...skills.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
function details(actor: number): void {
  const target = meter.value.target?.id
  if (target) void api.invoke('details:open', { kind: 'live', target, actor })
}

let off: (() => void) | null = null
onMounted(async () => {
  off = api.on('meter:dps', (m) => (meter.value = m))
  meter.value = await api.invoke('meter:get')
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div>
    <PageHeader title="Combat Meter" about="Damage of you and your party, decoded live from the game's network traffic by A2Tools DPS Meter's parser. Nothing is read from or written to the game itself.">
      <Button @click="api.invoke('meter:reset')">
        <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3" /></svg>
        Reset
      </Button>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-card bg-card px-4 py-3">
      <span class="text-xs font-medium uppercase tracking-wide text-darker">Targets</span>
      <Segmented :model-value="cfg.targetMode" :options="MODES" size="sm" @update:model-value="setMeter({ targetMode: $event as TargetMode })" />
    </div>

    <Section bare>
      <div class="overflow-hidden rounded-xl border border-card">
        <div class="flex items-center gap-4 border-b border-card bg-card px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-base font-semibold">{{ meter.target?.name || 'No target yet' }}</div>
            <div class="text-xs tabular-nums text-darker">
              <template v-if="meter.battleTime">{{ clock(meter.battleTime) }} · party {{ short(party) }}/s</template>
              <template v-else>Hit something and the fight shows here.</template>
            </div>
          </div>
          <div v-if="hp !== null" class="w-56">
            <div class="mb-0.5 flex justify-between text-[11px] tabular-nums text-darker">
              <span>HP</span><span>{{ (hp * 100).toFixed(1) }}% · {{ short(meter.target!.hp!) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-dark"><div class="h-full bg-danger" :style="{ width: `${hp * 100}%` }" /></div>
          </div>
          <div v-if="meter.ping !== null" class="text-right text-xs text-darker" title="Your ping to the game server">
            <div :class="['text-base font-semibold tabular-nums', pingClass]">{{ meter.ping }}<span class="text-xs font-normal"> ms</span></div>
            ping
          </div>
        </div>
        <table v-if="meter.rows.length" class="w-full text-sm">
          <thead class="text-xs uppercase tracking-wide text-darker">
            <tr class="border-b border-card">
              <th class="w-10 py-2 pl-4 text-left font-medium">#</th>
              <th class="text-left font-medium">Player</th>
              <th class="w-28 px-3 text-right font-medium">DPS</th>
              <th class="w-28 px-3 text-right font-medium">Damage</th>
              <th class="w-20 pr-4 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in meter.rows"
              :key="r.id"
              class="relative cursor-pointer border-b border-card/60 last:border-0 hover:bg-card"
              :title="`${r.className ?? 'Unknown class'}: click for skills`"
              @click="details(r.id)"
            >
              <td class="py-1.5 pl-4 text-xs tabular-nums text-darkest">{{ i + 1 }}</td>
              <td class="py-1.5">
                <div class="relative flex items-center gap-2">
                  <img v-if="icon(r.className)" :src="icon(r.className)!" class="size-5 shrink-0" alt="" />
                  <span v-else class="size-5 shrink-0" />
                  <span :class="['truncate', r.you ? 'font-semibold text-yellow' : '']">{{ r.name }}</span>
                </div>
                <div class="mt-1 h-1 overflow-hidden rounded-full bg-dark">
                  <div class="h-full" :style="{ width: `${(r.damage / top) * 100}%`, background: CLASS_COLORS[r.className ?? ''] ?? '#787b8a' }" />
                </div>
              </td>
              <td class="px-3 text-right font-medium tabular-nums">{{ short(r.dps) }}</td>
              <td class="px-3 text-right tabular-nums text-darker">{{ short(r.damage) }}</td>
              <td class="pr-4 text-right tabular-nums text-darker">{{ r.share.toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <div class="text-sm font-medium">{{ store.status?.state === 'locked' ? 'Waiting for a fight' : 'Waiting for the game' }}</div>
          <div class="text-xs text-darker">The meter fills in as soon as you or your party hit something.</div>
        </div>
      </div>
    </Section>

    <Section title="Meter overlay" icon="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5">
      <SettingRow label="Show the meter over the game" hint="Its own window while the game is open: drag it by its header, click a player for their skills.">
        <Toggle :model-value="cfg.enabled" @update:model-value="setMeter({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.enabled" label="Players listed">
        <Slider :model-value="cfg.rows" :min="1" :max="24" :step="1" @update:model-value="setMeter({ rows: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.enabled" label="Opacity">
        <Slider :model-value="cfg.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="setMeter({ opacity: $event })" />
      </SettingRow>
    </Section>

    <Section title="My skills overlay" icon="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z">
      <SettingRow label="Show my skills over the game" hint="Your own damage on the meter's target, skill by skill: DPS, share and damage of each.">
        <Toggle :model-value="skills.enabled" @update:model-value="setSkills({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="skills.enabled" label="Skills listed">
        <Slider :model-value="skills.rows" :min="1" :max="20" :step="1" @update:model-value="setSkills({ rows: $event })" />
      </SettingRow>
      <SettingRow v-if="skills.enabled" label="Opacity">
        <Slider :model-value="skills.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="setSkills({ opacity: $event })" />
      </SettingRow>
    </Section>
  </div>
</template>
