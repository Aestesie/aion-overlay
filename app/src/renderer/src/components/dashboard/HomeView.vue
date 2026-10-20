<script setup lang="ts">
// Home: who is playing and whether the game is being read, every overlay with its switch (the
// overlays' own settings are on their pages), and a card per page with what it has now.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import StatusDot, { statusText } from '@/components/StatusDot.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import { bridge } from '@/lib/bridge.ts'
import { currentWorld, nearbyPets, useSpawns } from '@/lib/spawns.ts'
import { timerNext } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import { formatKina } from '@shared/kina.ts'
import { NO_METER, type MeterData } from '@shared/meter.ts'
import type { Settings } from '@shared/settings.ts'
import { serverName } from '@shared/servers.ts'
import { TIMERS } from '@shared/timers.ts'

const emit = defineEmits<{ go: [page: string] }>()
const store = useApp()
const api = bridge()
const spawns = useSpawns()

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
const meter = ref<MeterData>(NO_METER)
const fights = ref<number | null>(null)
const overlaysOff = ref(false)
const offs: (() => void)[] = []
onMounted(async () => {
  offs.push(api.on('meter:dps', (m) => (meter.value = m)))
  offs.push(api.on('overlays:hidden', (off) => (overlaysOff.value = off)))
  offs.push(api.on('history:changed', async () => (fights.value = (await api.invoke('history:list')).filter((f) => !f.isTrain).length)))
  meter.value = await api.invoke('meter:get')
  overlaysOff.value = await api.invoke('overlays:hidden')
  fights.value = (await api.invoke('history:list')).filter((f) => !f.isTrain).length
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  for (const off of offs) off()
})

const greeting = computed(() => {
  const h = new Date(now.value).getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
})
const who = computed(() => {
  const s = store.status
  return [s?.character, s?.server ? serverName(s.server) : null, s?.level ? `Lv ${s.level}` : null].filter(Boolean).join(' · ')
})
const error = computed(() => (store.status?.state === 'error' ? (store.status.detail ?? 'The engine stopped with an error.') : null))

// ---- the overlays -----------------------------------------------------------------------------
type Overlay = { id: string; name: string; about: string; page: string; on: boolean; set: (on: boolean) => void }
function flip<K extends keyof Settings>(key: K, field: string): (on: boolean) => void {
  return (on) => void store.set(key, { ...(store.settings[key] as object), [field]: on } as unknown as Settings[K])
}
const overlays = computed<Overlay[]>(() => {
  const s = store.settings
  return [
    { id: 'hud', name: 'Pets HUD', about: 'Souls, nearby soul monsters, Hidden Cubes', page: 'settings', on: s.hud.enabled, set: flip('hud', 'enabled') },
    { id: 'meter', name: 'Damage meter', about: 'You and your party, live', page: 'meter', on: s.meter.enabled, set: flip('meter', 'enabled') },
    { id: 'skills', name: 'My skills', about: 'Your damage, skill by skill', page: 'meter', on: s.skills.enabled, set: flip('skills', 'enabled') },
    { id: 'buffs', name: 'Buffs', about: 'What is on you, and for how long', page: 'buffs', on: s.buffs.enabled, set: flip('buffs', 'enabled') },
    { id: 'cc', name: 'CC / Debuffs', about: 'When you are stunned, rooted, feared…', page: 'buffs', on: s.buffs.cc, set: flip('buffs', 'cc') },
    { id: 'training', name: 'Training', about: 'Training dummy runs: clock and DPS', page: 'training', on: s.dummy.overlay, set: flip('dummy', 'overlay') },
    { id: 'minimap', name: 'Map', about: 'Your zone, tracked pets, cubes', page: 'map', on: s.minimap.enabled, set: flip('minimap', 'enabled') },
    { id: 'timerBar', name: 'Countdown bar', about: 'Events with an alert on', page: 'events', on: s.timerBar.enabled, set: flip('timerBar', 'enabled') },
    {
      id: 'killFeed',
      name: 'Kill feed',
      about: 'Player kills around you',
      page: 'pvp',
      on: s.killFeed.open,
      set: (on) => void api.invoke(on ? 'killfeed:open' : 'killfeed:close'),
    },
    { id: 'merchant', name: 'Merchant pets', about: 'When you open the Black Cloud shop', page: 'settings', on: s.hud.merchant, set: flip('hud', 'merchant') },
  ]
})
const overlaysOn = computed(() => overlays.value.filter((o) => o.on).length)
async function toggleAll(): Promise<void> {
  overlaysOff.value = await api.invoke('overlays:toggle')
}

// ---- what each page has now -------------------------------------------------------------------
function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}
const zone = computed(() => {
  const id = spawns.value ? currentWorld(store.nearby, spawns.value) : null
  return id !== null ? (spawns.value?.worlds[id]?.name ?? null) : null
})
const nearbyCount = computed(() => (spawns.value ? nearbyPets(store.nearby, spawns.value).filter((n) => !store.hiddenPet(n.pet)).length : 0))
const nextEvent = computed(() => {
  const t = store.settings.timers
  const on = TIMERS.filter((d) => d.schedule.kind !== 'boss' && t.enabled[d.id] && t.shown[d.id])
  return on.map((def) => ({ def, at: timerNext(def, now.value) })).sort((a, b) => a.at - b.at)[0] ?? null
})
const bossesUp = computed(() => Object.values(store.fieldBosses).filter((b) => b.up).length)
const pvp = computed(() => ({ kills: store.pvp.filter((k) => k.mine).length, deaths: store.pvp.filter((k) => k.died).length }))
const myDps = computed(() => meter.value.rows.find((r) => r.you) ?? null)

const ICONS: Record<string, string> = {
  meter: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5',
  map: 'M1.5 4l4.5-2 4 2 4.5-2v10l-4.5 2-4-2-4.5 2zM6 2v10M10 4v10',
  pets: 'M5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM3 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM13 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 9c-2 0-3.5 2-3.5 3.3 0 1 1 1.2 2.2 1.2.6 0 .9-.3 1.3-.3s.7.3 1.3.3c1.2 0 2.2-.2 2.2-1.2C11.5 11 10 9 8 9Z',
  pvp: 'M3 13 13 3M9.5 3H13v3.5M3 3l4 4M13 13l-3-3',
  buffs: 'M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z',
  events: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3',
  bosses: 'M8 2a5 5 0 0 0-3.5 8.5V13h7v-2.5A5 5 0 0 0 8 2zM6 8.5h.01M10 8.5h.01',
  history: 'M2 8a6 6 0 1 0 1.8-4.3M2 2.5v3h3M8 5v3l2 1.5',
  session: 'M2.5 11.5 6 8l2.5 2.5 5-5M10 5.5h3.5V9',
}
</script>

<template>
  <div>
    <!-- Who and what: the greeting, the game's state, all overlays at once. -->
    <div class="relative mb-6 overflow-hidden rounded-xl border border-card bg-gradient-to-br from-accent-soft/70 via-card to-card px-6 py-6">
      <img src="/icon.png" alt="" class="pointer-events-none absolute -right-6 -top-6 size-40 opacity-10" draggable="false" />
      <h1 class="text-3xl font-bold tracking-tight">{{ greeting }}{{ store.status?.character ? `, ${store.status.character}` : '' }}</h1>
      <p class="mt-1 text-sm text-darker">Your pets, fights, buffs, maps and timers, read from the game as you play.</p>
      <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span class="flex items-center gap-2 rounded-full border border-card bg-default/60 px-3 py-1 font-medium">
          <StatusDot :status="store.status" />{{ statusText(store.status) }}<span v-if="who" class="text-darker">· {{ who }}</span>
        </span>
        <span class="rounded-full border border-card bg-default/60 px-3 py-1 font-medium">{{ overlaysOn }} overlays on</span>
        <button
          type="button"
          :class="['rounded-full border px-3 py-1 font-medium transition', overlaysOff ? 'border-yellow/50 bg-yellow/10 text-yellow' : 'border-card bg-default/60 hover:bg-dark']"
          title="Alt+Shift+E does the same from the game"
          @click="toggleAll"
        >
          {{ overlaysOff ? 'Overlays hidden: show them' : 'Hide all overlays' }} <span class="text-darkest">Alt+Shift+E</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 flex items-start gap-3 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
      <svg viewBox="0 0 16 16" class="mt-0.5 size-4 shrink-0 text-danger" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5 15 14H1zM8 6v3.5M8 11.8v.2" /></svg>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-danger">The game's traffic can't be read</div>
        <div class="text-sm text-dark">{{ error }}</div>
      </div>
      <Button size="sm" @click="api.invoke('tracker:restart')">Try again</Button>
    </div>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">Overlays</h2>
      <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div
          v-for="o in overlays"
          :key="o.id"
          :class="['flex items-center gap-3 rounded-xl border px-3.5 py-3 transition', o.on ? 'border-accent/40 bg-accent-soft/30' : 'border-card bg-card']"
        >
          <button type="button" class="min-w-0 flex-1 text-left" :title="`${o.name}: its settings`" @click="emit('go', o.page)">
            <div class="truncate text-sm font-medium">{{ o.name }}</div>
            <div class="truncate text-xs text-darker">{{ o.about }}</div>
          </button>
          <Toggle :model-value="o.on" @update:model-value="o.set($event)" />
        </div>
      </div>
    </section>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">In game</h2>
      <div class="grid grid-cols-2 gap-3">
        <button v-for="card in [
          { page: 'meter', title: 'Combat Meter', line: meter.target ? `${meter.target.name}: ${myDps ? `you ${short(myDps.dps)}/s` : `${meter.rows.length} players`}` : 'No fight right now.' },
          { page: 'map', title: 'Map', line: zone ? `${zone}${store.cubes.length ? ` · ${store.cubes.length} Hidden Cube${store.cubes.length > 1 ? 's' : ''} nearby` : ''}` : 'Where you are shows once you enter a zone.' },
          { page: 'pets', title: 'Pets', line: `${store.sessionSouls} souls this session · ${nearbyCount} pet${nearbyCount === 1 ? '' : 's'} around you` },
          { page: 'buffs', title: 'Buffs', line: store.settings.buffs.enabled ? `${store.buffs.length} on you now` : 'The buffs overlay is off.' },
          { page: 'pvp', title: 'PvP', line: `${store.pvp.length} kills seen · yours ${pvp.kills}, deaths ${pvp.deaths}` },
          { page: 'bosses', title: 'Field Bosses', line: Object.keys(store.fieldBosses).length ? `${bossesUp} alive in Verteron` : 'Open the map in game to read them.' },
        ]" :key="card.page" type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', card.page)">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS[card.page]" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ card.title }}</span>
            <span class="block truncate text-xs text-darker">{{ card.line }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
        <button type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', 'events')">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.events" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">Event Alerts</span>
            <span v-if="nextEvent" class="block truncate text-xs text-darker">{{ nextEvent.def.name }} in <span class="text-yellow"><Countdown :at="nextEvent.at" :now="now" /></span></span>
            <span v-else class="block truncate text-xs text-darker">No alerts on: pick the events to hear about.</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">Records</h2>
      <div class="grid grid-cols-2 gap-3">
        <button v-for="card in [
          { page: 'history', title: 'History', line: fights === null ? '…' : `${fights} boss fight${fights === 1 ? '' : 's'} saved` },
          { page: 'session', title: 'Session', line: store.kinaRate !== null ? `${formatKina(store.kinaRate)} Kina per hour · ${store.sessionSouls} souls` : `${store.sessionSouls} souls so far` },
        ]" :key="card.page" type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', card.page)">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS[card.page]" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ card.title }}</span>
            <span class="block truncate text-xs text-darker">{{ card.line }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
      </div>
    </section>
  </div>
</template>
