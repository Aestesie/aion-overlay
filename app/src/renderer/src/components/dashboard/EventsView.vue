<script setup lang="ts">
// Event Alerts: the game's periodic events, each with how long until it starts and its alert (on or
// off, and how early). The bar above: the server region, the chime and its volume, the bubble's
// shake, and the countdown bar over the game. A click on the bubble during an alert opens this page
// with that event highlighted.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from '@/components/Button.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { playChime } from '@/lib/chime.ts'
import { CLOCK_ICON, EVENT_ICONS, leadLabel, setAlert, setLead, timerNext } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import { leadChoices, REGIONS, TIMERS, type TimerDef, type TimerId } from '@shared/timers.ts'

const store = useApp()
const cfg = computed(() => store.settings.timers)
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(ticker))

const EVENT_IMAGES: Partial<Record<TimerId, string>> = { shugo: 'events/shugo.webp', rift: 'events/rift.webp' }
const alerting = computed(() => new Set(store.alerting.map((a) => a.id)))
const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (ms: number): string => new Date(ms).toLocaleDateString([], { weekday: 'short' })

/** The events (field bosses have their own page), soonest first. */
const rows = computed(() =>
  TIMERS.filter((d) => d.schedule.kind !== 'boss')
    .map((def) => {
      const next = timerNext(def, now.value)
      const today = new Date(next).toDateString() === new Date(now.value).toDateString()
      return { def, next, at: today ? time(next) : `${day(next)} ${time(next)}` }
    })
    .sort((a, b) => a.next - b.next),
)
const on = (def: TimerDef): boolean => (cfg.value.enabled[def.id] ?? false) && (cfg.value.shown[def.id] ?? false)

const set = (patch: Partial<typeof cfg.value>): void => void store.set('timers', { ...cfg.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
const bar = computed(() => store.settings.timerBar)

// The timers the bubble was clicked for: scrolled to, and highlighted for a moment.
const FLASH_MS = 2500
const flashing = ref(new Set<TimerId>())
const list = ref<HTMLElement | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.timerFocus,
  async (focus) => {
    if (!focus || Date.now() - focus.at > FLASH_MS) return
    flashing.value = new Set(focus.ids)
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (flashing.value = new Set()), FLASH_MS)
    await nextTick()
    list.value?.querySelector(`[data-timer="${focus.ids[0]}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
  { immediate: true },
)
onBeforeUnmount(() => flashTimer && clearTimeout(flashTimer))
</script>

<template>
  <div>
    <PageHeader title="Event Alerts" about="The game's events in your local time. Turn on an alert to get a chime and a shaking bubble before it starts, and its countdown over the game.">
      <Button @click="playChime(cfg.volume)">
        <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3" /></svg>
        Test the chime
      </Button>
    </PageHeader>

    <div class="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-card bg-card px-4 py-3 text-sm">
      <label class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">Region</span>
        <SelectBox
          :model-value="cfg.region"
          :options="REGIONS.map((r) => ({ id: r.id, label: r.label + (r.confirmed ? '' : ' (unconfirmed)') }))"
          @update:model-value="set({ region: $event })"
        />
      </label>
      <span class="h-6 w-px bg-light" />
      <label class="flex items-center gap-2">
        <Toggle :model-value="cfg.sound" @update:model-value="set({ sound: $event })" />
        <span>Chime</span>
      </label>
      <label v-if="cfg.sound" class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">Volume</span>
        <Slider :model-value="cfg.volume" :min="0.1" :max="1" :step="0.05" :format="pct" @update:model-value="set({ volume: $event })" />
      </label>
      <span class="h-6 w-px bg-light" />
      <label class="flex items-center gap-2">
        <Toggle :model-value="cfg.shake" @update:model-value="set({ shake: $event })" />
        <span>Shake the bubble</span>
      </label>
      <span class="h-6 w-px bg-light" />
      <label class="flex items-center gap-2" title="The timers with an alert on, starting within 13 hours, over the game. Drag it to move it.">
        <Toggle :model-value="bar.enabled" @update:model-value="store.set('timerBar', { ...bar, enabled: $event })" />
        <span>Countdown bar over the game</span>
      </label>
      <label v-if="bar.enabled" class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">Opacity</span>
        <Slider :model-value="bar.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="store.set('timerBar', { ...bar, opacity: $event })" />
      </label>
    </div>

    <div ref="list" class="overflow-hidden rounded-xl border border-card">
      <table class="w-full text-sm">
        <thead class="bg-card text-xs uppercase tracking-wide text-darker">
          <tr class="border-b border-card">
            <th class="py-2.5 pl-4 text-left font-medium">Event</th>
            <th class="w-40 px-3 text-left font-medium">Next in</th>
            <th class="w-48 px-3 text-left font-medium">Alert me</th>
            <th class="w-20 pr-4 text-right font-medium">Alert</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--line)]">
          <tr
            v-for="r in rows"
            :key="r.def.id"
            :data-timer="r.def.id"
            :class="[
              'transition-[background-color,box-shadow] duration-700',
              flashing.has(r.def.id) ? 'bg-yellow/20 ring-2 ring-inset ring-yellow/60' : alerting.has(r.def.id) ? 'bg-yellow/10' : 'hover:bg-card',
            ]"
            :title="r.def.detail"
          >
            <td class="py-2.5 pl-4">
              <div class="flex items-center gap-3">
                <div class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card bg-dark text-dark">
                  <img v-if="EVENT_IMAGES[r.def.id]" :src="EVENT_IMAGES[r.def.id]" alt="" class="size-full object-cover" draggable="false" />
                  <svg v-else viewBox="0 0 16 16" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                    <path :d="EVENT_ICONS[r.def.id] ?? CLOCK_ICON" />
                  </svg>
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 font-medium">
                    <span v-if="alerting.has(r.def.id)" class="size-1.5 shrink-0 animate-pulse rounded-full bg-yellow" />
                    {{ r.def.name }}
                    <span v-if="!r.def.confirmed" class="rounded border border-yellow/40 px-1 text-[10px] font-normal text-yellow" title="The times are not checked against the game yet">unconfirmed</span>
                  </div>
                  <div class="truncate text-xs text-darker">{{ r.def.detail }}</div>
                </div>
              </div>
            </td>
            <td class="px-3">
              <div class="font-medium text-yellow"><Countdown :at="r.next" :now="now" /></div>
              <div class="text-xs text-darkest">{{ r.at }}</div>
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
    <p class="mt-3 text-xs text-darkest">Weekly events (the siege) are at your region's own time; the region follows your server when you enter the world.</p>
  </div>
</template>
