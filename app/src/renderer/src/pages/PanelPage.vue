<script setup lang="ts">
// The dashboard the bubble opens: a window of its own, with its title bar (dragged to move, and the
// window's buttons), a sidebar of pages, and the page. The pages are the old panel's tabs for now;
// they get their own layouts one by one (overlay-plan.md, the dashboard).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FightsTab from '@/components/panel/FightsTab.vue'
import CollectionTab from '@/components/panel/CollectionTab.vue'
import PetDetail from '@/components/panel/PetDetail.vue'
import PvpLogTab from '@/components/panel/PvpLogTab.vue'
import SessionTab from '@/components/panel/SessionTab.vue'
import SettingsTab from '@/components/panel/SettingsTab.vue'
import TimersTab from '@/components/panel/TimersTab.vue'
import StatusDot, { statusText } from '@/components/StatusDot.vue'
import { bridge } from '@/lib/bridge.ts'
import { useApp } from '@/stores/app.ts'
import { DISPLAY_NAME } from '@shared/app.ts'
import { serverName } from '@shared/servers.ts'

type PageId = 'pets' | 'timers' | 'pvp' | 'fights' | 'session' | 'settings'
interface Page {
  id: PageId
  label: string
  /** What the page is, under its title. */
  about: string
  /** An SVG path, 16x16, stroked. */
  icon: string
}

const PAGES: Record<PageId, Page> = {
  pets: { id: 'pets', label: 'Pets', about: 'Every pet with its level and souls, and where the ones you still need drop.', icon: 'M5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM3 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM13 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 9c-2 0-3.5 2-3.5 3.3 0 1 1 1.2 2.2 1.2.6 0 .9-.3 1.3-.3s.7.3 1.3.3c1.2 0 2.2-.2 2.2-1.2C11.5 11 10 9 8 9Z' },
  timers: { id: 'timers', label: 'Timers', about: 'The game’s events and field bosses: when each starts, and which ones alert.', icon: 'M8 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 6v3l2 1.5M6.5 1.5h3' },
  pvp: { id: 'pvp', label: 'PvP', about: 'Every player killed around you, as the game credits it.', icon: 'M3 13 13 3M9.5 3H13v3.5M3 3l4 4M13 13l-3-3' },
  fights: { id: 'fights', label: 'Fights', about: 'Boss fights saved as you play: each player’s damage and skills.', icon: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5' },
  session: { id: 'session', label: 'Session', about: 'This session: souls, crystals and Kina.', icon: 'M2.5 11.5 6 8l2.5 2.5 5-5M10 5.5h3.5V9' },
  settings: { id: 'settings', label: 'Settings', about: 'The overlays, the app and the Lokthar sync.', icon: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM13 8a5 5 0 0 0-.1-.9l1.4-1.1-1.4-2.4-1.7.6a5 5 0 0 0-1.5-.9L9.4 1.5H6.6l-.3 1.8a5 5 0 0 0-1.5.9l-1.7-.6-1.4 2.4 1.4 1.1a5 5 0 0 0 0 1.8l-1.4 1.1 1.4 2.4 1.7-.6a5 5 0 0 0 1.5.9l.3 1.8h2.8l.3-1.8a5 5 0 0 0 1.5-.9l1.7.6 1.4-2.4-1.4-1.1c.1-.3.1-.6.1-.9Z' },
}
const SECTIONS: { title: string | null; pages: PageId[] }[] = [
  { title: 'In game', pages: ['pets', 'timers', 'pvp'] },
  { title: 'Records', pages: ['fights', 'session'] },
]

const store = useApp()
const api = bridge()

/** The page shown: remembered on this computer between openings. */
const STORE_KEY = 'lokthar.page'
function savedPage(): PageId {
  try {
    const p = localStorage.getItem(STORE_KEY) as PageId | null
    return p && p in PAGES ? p : 'pets'
  } catch {
    return 'pets'
  }
}
const page = ref<PageId>(savedPage())
watch(page, (p) => {
  try {
    localStorage.setItem(STORE_KEY, p)
  } catch {
    // Not kept: it opens on Pets next time.
  }
})
function go(p: PageId): void {
  if (p !== 'pets') store.openPet(null)
  page.value = p
}
const current = computed(() => PAGES[page.value])

const maximized = ref(false)
const minimize = (): void => void api.invoke('panel:minimize')
const maximize = (): void => void api.invoke('panel:maximize')
const hide = (): void => void api.invoke('panel:hide')

/** Who is playing, as the title bar shows it: "Ksix · Kaisinel". */
const who = computed(() => {
  const s = store.status
  return [s?.character, s?.server ? serverName(s.server) : null].filter(Boolean).join(' · ')
})

// Escape backs out of a pet's map.
const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && store.openPetId !== null) store.openPet(null)
}
const offs: (() => void)[] = []
onMounted(() => {
  window.addEventListener('keydown', onKey)
  // A pet clicked in the merchant window: its drop locations.
  offs.push(
    api.on('panel:showPet', (pet) => {
      page.value = 'pets'
      store.openPet(pet)
    }),
  )
  // The bubble clicked during an alert: the Timers page, on the timers that alerted.
  offs.push(
    api.on('panel:showTimers', (ids) => {
      store.openPet(null)
      page.value = 'timers'
      store.timerFocus = { ids, at: Date.now() }
    }),
  )
  offs.push(api.on('panel:maximized', (m) => (maximized.value = m)))
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  for (const off of offs) off()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-app text-default">
    <!-- The title bar: dragged to move the window (its buttons excepted). -->
    <header class="drag flex h-10 shrink-0 items-center gap-3 border-b border-card pl-3">
      <img src="/icon.png" alt="" class="size-5" draggable="false" />
      <span class="text-sm font-semibold">{{ DISPLAY_NAME }}</span>
      <span class="ml-4 flex min-w-0 items-center gap-1.5 rounded-full border border-card bg-card px-2.5 py-0.5 text-xs text-darker">
        <StatusDot :status="store.status" />
        <span class="truncate">{{ statusText(store.status) }}</span>
        <span v-if="who" class="truncate text-dark">· {{ who }}</span>
      </span>
      <span v-if="store.sessionSouls" class="text-xs text-green">+{{ store.sessionSouls }} souls this session</span>
      <div class="no-drag ml-auto flex h-full">
        <button type="button" class="flex w-11 items-center justify-center text-darker hover:bg-dark hover:text-default" title="Minimize" @click="minimize">
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 8h9" /></svg>
        </button>
        <button type="button" class="flex w-11 items-center justify-center text-darker hover:bg-dark hover:text-default" :title="maximized ? 'Restore' : 'Maximize'" @click="maximize">
          <svg v-if="!maximized" viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="3.5" width="9" height="9" rx="1" /></svg>
          <svg v-else viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5.5 5.5V3.5h7v7h-2M3.5 5.5h7v7h-7z" /></svg>
        </button>
        <button type="button" class="flex w-11 items-center justify-center text-darker hover:bg-[#e5484d] hover:text-white" title="Close (the app keeps running in the tray)" @click="hide">
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <nav class="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-card bg-darker px-2 py-3">
        <div v-for="s in SECTIONS" :key="s.title ?? ''">
          <div v-if="s.title" class="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-darkest">{{ s.title }}</div>
          <button
            v-for="id in s.pages"
            :key="id"
            type="button"
            :class="[
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition',
              page === id ? 'bg-card font-medium text-default' : 'text-darker hover:bg-dark hover:text-default',
            ]"
            @click="go(id)"
          >
            <svg viewBox="0 0 16 16" :class="['size-4 shrink-0', page === id ? 'text-accent' : '']" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path :d="PAGES[id].icon" />
            </svg>
            {{ PAGES[id].label }}
          </button>
        </div>
        <button
          type="button"
          :class="[
            'mt-auto flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition',
            page === 'settings' ? 'bg-card font-medium text-default' : 'text-darker hover:bg-dark hover:text-default',
          ]"
          @click="go('settings')"
        >
          <svg viewBox="0 0 16 16" :class="['size-4 shrink-0', page === 'settings' ? 'text-accent' : '']" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path :d="PAGES.settings.icon" />
          </svg>
          Settings
        </button>
      </nav>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <div :class="['mx-auto px-6 py-5', page === 'pets' && store.openPetId !== null ? 'max-w-6xl' : 'max-w-3xl']">
          <div class="mb-3">
            <h1 class="text-xl font-semibold">{{ current.label }}</h1>
            <p class="text-sm text-darker">{{ current.about }}</p>
          </div>
          <div v-if="!store.ready" class="py-6 text-center text-sm text-darker">Loading…</div>
          <template v-else-if="page === 'pets'">
            <PetDetail v-if="store.openPetId !== null" :id="store.openPetId" class="-mx-3 h-[calc(100vh-11rem)]" />
            <CollectionTab v-else class="-mx-3" />
          </template>
          <TimersTab v-else-if="page === 'timers'" class="-mx-3" />
          <PvpLogTab v-else-if="page === 'pvp'" class="-mx-3" />
          <FightsTab v-else-if="page === 'fights'" class="-mx-3" />
          <SessionTab v-else-if="page === 'session'" class="-mx-3" />
          <SettingsTab v-else class="-mx-3" />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.drag {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
</style>
