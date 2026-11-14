<script setup lang="ts">
// The Unified HUD's page: what it is, a preview of the bar as these settings make it (a sample:
// Kina coming in, an event a few minutes away), and its settings (pages/UnifiedPage.vue).
import { computed } from 'vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import Segmented from '@/components/ui/Segmented.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { t } from '@/lib/i18n.ts'
import { panelStyle } from '@/lib/overlayLook.ts'
import { EVENT_ICONS } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'

const store = useApp()
const cfg = computed(() => store.settings.unified)
const set = (patch: Partial<typeof cfg.value>): void => void store.set('unified', { ...cfg.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
const minutes = (list: number[]) => list.map((m) => ({ id: m, label: t('{n} min', { n: m }) }))
const COUNTDOWN = [5, 10, 15, 20, 30]
const STAY = [2, 5, 10, 15, 30]
const SECONDS = [5, 8, 12, 20, 30]
const TARGET_MODES = [
  { id: 'always' as const, label: 'Always' },
  { id: 'players' as const, label: 'While a player is selected' },
  { id: 'meter' as const, label: "As the meter is set" },
]
const BUTTONS = [
  { id: 'hover' as const, label: 'On hover' },
  { id: 'always' as const, label: 'Always' },
]
const BUTTON_ICONS = [
  'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5',
  'M1.5 4l4.5-2 4 2 4.5-2v10l-4.5 2-4-2-4.5 2zM6 2v10M10 4v10',
  'M3 13 13 3M9.5 3H13v3.5M3 3l4 4M13 13l-3-3',
  'M2.5 4h2M2.5 8h2M2.5 12h2M6.5 4h7M6.5 8h7M6.5 12h4',
]
</script>

<template>
  <div>
    <PageHeader
      title="Unified HUD"
      about="One small bar at the top of the game, in place of a screen full of widgets. It stays compact, unfolds when you hover it, and shows things only when they matter. Every overlay can still open on its own from its buttons."
    >
      <Toggle :model-value="cfg.enabled" @update:model-value="set({ enabled: $event })" />
    </PageHeader>

    <!-- The bar as these settings make it. -->
    <div class="mb-6 flex flex-col items-center gap-2.5 rounded-xl border border-card bg-[#1b2224] px-4 py-5">
      <div class="flex h-9 items-center gap-2.5 whitespace-nowrap rounded-[14px] border px-2.5" :style="{ ...panelStyle(cfg.opacity), zoom: cfg.scale }">
        <template v-if="cfg.earnings">
          <span class="text-xs font-semibold tabular-nums text-yellow">1.72M <span class="font-medium text-darker">Kina/h</span></span>
          <span class="h-4 w-px bg-light" />
        </template>
        <img src="/icon.png" alt="" class="size-[18px]" draggable="false" />
        <span v-if="cfg.clock" class="text-xs font-medium tabular-nums text-dark">21:52</span>
        <span v-if="cfg.odyle" class="flex items-center gap-1 text-xs font-medium tabular-nums text-dark"><img :src="'items/odyle-energy.webp'" alt="" class="size-4" draggable="false" />120</span>
        <template v-if="cfg.events">
          <span class="flex items-center gap-1 text-orange">
            <svg viewBox="0 0 16 16" class="size-[15px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path :d="EVENT_ICONS.shugo" /></svg>
            <span class="text-xs font-semibold tabular-nums">7:42</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-[15px] text-darker" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path :d="EVENT_ICONS.rift" /></svg>
        </template>
        <template v-if="cfg.buttons === 'always'">
          <span class="h-4 w-px bg-light" />
          <svg v-for="d in BUTTON_ICONS" :key="d" viewBox="0 0 16 16" class="mx-1 size-4 text-darker" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path :d="d" /></svg>
        </template>
        <span v-if="cfg.ping" class="flex items-center gap-1.5 text-xs font-medium tabular-nums text-dark"><span class="size-1.5 rounded-full bg-green" />42 ms</span>
      </div>
      <span class="text-xs text-[#c4d0d3]">{{ t('A sample: at rest, with Kina coming in and an event 8 minutes away. Drag the real one in game to place it.') }}</span>
    </div>

    <template v-if="cfg.enabled">
      <Section title="Always on the bar">
        <SettingRow label="Next events" hint="The next two timers with their alert on, as icons: grey while far, yellow within half an hour, then orange with a countdown. Hover them for the whole list.">
          <div class="flex items-center gap-3">
            <SelectBox v-if="cfg.events" size="sm" :model-value="cfg.countdownMinutes" :options="minutes(COUNTDOWN)" @update:model-value="set({ countdownMinutes: $event })" />
            <Toggle :model-value="cfg.events" @update:model-value="set({ events: $event })" />
          </div>
        </SettingRow>
        <SettingRow label="Ping" hint="Your ping to the game server.">
          <Toggle :model-value="cfg.ping" @update:model-value="set({ ping: $event })" />
        </SettingRow>
        <SettingRow label="Overlay buttons" hint="DPS meter, Map, Kill feed, Pets: one click peeks under the bar, a second opens the overlay itself. Boss Runs stay open under the bar until you fold them. With them, the speaker that mutes every sound and the cog that opens the app.">
          <Segmented size="sm" :model-value="cfg.buttons" :options="BUTTONS" @update:model-value="set({ buttons: $event })" />
        </SettingRow>
      </Section>

      <Section title="Shows up when it matters">
        <SettingRow label="Your target" hint="Unfolds when you hit something: its health, your damage and DPS; for a player you target, class, legion, combat power and gear score. Folds this long after your last hit.">
          <div class="flex items-center gap-3">
            <SelectBox v-if="cfg.target" size="sm" :model-value="cfg.targetSeconds" :options="SECONDS.map((s) => ({ id: s, label: t('{n} s', { n: s }) }))" @update:model-value="set({ targetSeconds: $event })" />
            <Toggle :model-value="cfg.target" @update:model-value="set({ target: $event })" />
          </div>
        </SettingRow>
        <SettingRow v-if="cfg.target" label="Follow my last hit" hint="What the DPS meter follows while this is on: your last hit, a player or a boss, so hitting a player shows at once. This changes the meter overlay too. 'While a player is selected' keeps the meter's own mode otherwise.">
          <SelectBox size="sm" :model-value="cfg.targetMode" :options="TARGET_MODES.map((o) => ({ id: o.id, label: t(o.label) }))" @update:model-value="set({ targetMode: $event })" />
        </SettingRow>
        <SettingRow label="Kina and Abyss Points" hint="Per hour, to the left of the bar, while they come in. Hidden this long after the last gain.">
          <div class="flex items-center gap-3">
            <SelectBox v-if="cfg.earnings" size="sm" :model-value="cfg.earningsMinutes" :options="minutes(STAY)" @update:model-value="set({ earningsMinutes: $event })" />
            <Toggle :model-value="cfg.earnings" @update:model-value="set({ earnings: $event })" />
          </div>
        </SettingRow>
        <SettingRow label="Rift farm" hint="During a Spacetime Rift, the Abyss Points show that rift's total instead of the hourly rate.">
          <Toggle :model-value="cfg.rift" @update:model-value="set({ rift: $event })" />
        </SettingRow>
        <SettingRow label="Enemies nearby" hint="A red count of the players in view who can attack you (PvP on, or anyone in the Abyss); hover it for the list.">
          <Toggle :model-value="cfg.enemies" @update:model-value="set({ enemies: $event })" />
        </SettingRow>
        <SettingRow label="Field boss alive" hint="A boss with its alert on stays on the bar as its portrait while it lives.">
          <Toggle :model-value="cfg.bosses" @update:model-value="set({ bosses: $event })" />
        </SettingRow>
        <SettingRow label="Hidden Cube" hint="A cube in view, with how far and which way; hover it for the map.">
          <Toggle :model-value="cfg.cubes" @update:model-value="set({ cubes: $event })" />
        </SettingRow>
        <SettingRow label="Your last death" hint="A skull on the bar; hover it for where you died. Gone this long after.">
          <div class="flex items-center gap-3">
            <SelectBox v-if="cfg.death" size="sm" :model-value="cfg.deathMinutes" :options="minutes(STAY)" @update:model-value="set({ deathMinutes: $event })" />
            <Toggle :model-value="cfg.death" @update:model-value="set({ death: $event })" />
          </div>
        </SettingRow>
        <SettingRow label="Guild events" hint="A line under the bar 5 minutes before one starts, and again as it does.">
          <Toggle :model-value="cfg.guild" @update:model-value="set({ guild: $event })" />
        </SettingRow>
      </Section>

      <Section title="Optional">
        <SettingRow label="Local time" hint="The clock, for full-screen play.">
          <Toggle :model-value="cfg.clock" @update:model-value="set({ clock: $event })" />
        </SettingRow>
        <SettingRow label="Odyle Energy" hint="The energy of the character you're playing.">
          <Toggle :model-value="cfg.odyle" @update:model-value="set({ odyle: $event })" />
        </SettingRow>
      </Section>

      <Section title="Look">
        <SettingRow label="Opacity">
          <Slider :model-value="cfg.opacity" :min="0.3" :max="1" :step="0.02" :format="pct" @update:model-value="set({ opacity: $event })" />
        </SettingRow>
        <SettingRow label="Size">
          <Slider :model-value="cfg.scale" :min="0.75" :max="1.75" :step="0.05" :format="pct" @update:model-value="set({ scale: $event })" />
        </SettingRow>
        <SettingRow label="Hide the widgets it replaces" hint="The timer bar, Enemies nearby and the Boss Runs list stay closed while the Unified HUD is on. The enemy sound still plays.">
          <Toggle :model-value="cfg.replace" @update:model-value="set({ replace: $event })" />
        </SettingRow>
        <SettingRow label="Mute every sound" hint="Cubes, enemies and the timers' chime: the same switch as the speaker on the bar.">
          <Toggle :model-value="store.settings.muted" @update:model-value="store.set('muted', $event)" />
        </SettingRow>
        <SettingRow label="Position" hint="Drag the bar in game to move it. This puts it back at the top centre of the screen.">
          <button type="button" class="rounded-md border border-light px-2.5 py-1 text-xs text-dark hover:bg-dark" @click="set({ position: null })">{{ t('Reset') }}</button>
        </SettingRow>
      </Section>
    </template>
  </div>
</template>
