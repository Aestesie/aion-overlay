<script setup lang="ts">
// The map overlay: your zone around you, following you, with the spawns of your tracked pets (the
// ones pinned in the collection, and those whose soul monsters are around you), and the Hidden
// Cubes in view as golden cubes. Moved by its header; the wheel or the +/- buttons zoom (remembered); dragging the map
// looks around, and it follows you again a few seconds later. Hidden while the zone is not known.
// The minimize button shrinks it to its header (the zone and the cubes in view).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CollapseButton from '@/components/CollapseButton.vue'
import PetIcon from '@/components/PetIcon.vue'
import WorldMap, { type MapLayer } from '@/components/WorldMap.vue'
import { bridge } from '@/lib/bridge.ts'
import { displayName } from '@/lib/petDb.ts'
import { currentWorld, nearbyPets, useSpawns } from '@/lib/spawns.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { blankPet } from '@shared/tracker.ts'

/** The map overlay follows you rather than fitting anything. */
const NO_FOCUS: [number, number][] = []
const PALETTE = ['#f76b15', '#30a46c', '#0090ff', '#e54666', '#12a594', '#ab4aba', '#8e8c99', '#ffffff']

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.minimap)
const spawns = useSpawns()

const worldId = computed(() => (spawns.value ? currentWorld(store.nearby, spawns.value) : null))
const world = computed(() => (spawns.value && worldId.value !== null ? (spawns.value.worlds[worldId.value] ?? null) : null))

/** Tracked pets: pinned ones, then those whose soul monsters are around you; each its colour. */
const tracked = computed(() => {
  if (!spawns.value) return []
  const ids = [...store.settings.hud.pinned, ...nearbyPets(store.nearby, spawns.value).map((n) => n.pet)]
  return [...new Set(ids)]
    .filter((id) => !store.hiddenPet(id))
    .slice(0, PALETTE.length)
    .map((id, i) => ({ id, color: PALETTE[i]! }))
})

const layers = computed<MapLayer[]>(() =>
  tracked.value.flatMap(({ id, color }) =>
    (spawns.value?.pets[id] ?? []).flatMap((d) => {
      const w = d.worlds.find((x) => x.world === worldId.value)
      return w ? [{ key: `${id}-${d.npc}`, points: w.points, color, active: false }] : []
    }),
  ),
)
/** Only the tracked pets with spawns in this zone, for the legend. */
const legend = computed(() =>
  tracked.value.filter(({ id }) => (spawns.value?.pets[id] ?? []).some((d) => d.worlds.some((w) => w.world === worldId.value))),
)
const cubes = computed(() => store.cubes.map((c) => c.position))
const pet = (id: number) => store.pets.find((p) => p.id === id) ?? blankPet(id)

const drag = windowDrag({ move: 'minimap:moveTo', end: 'minimap:dragEnd' })
const setZoom = (zoom: number): void =>
  void api.invoke('settings:set', 'minimap', { ...cfg.value, zoom: Math.min(40, Math.max(1, zoom)) })
const toggleCollapsed = (): void => void api.invoke('settings:set', 'minimap', { ...cfg.value, collapsed: !cfg.value.collapsed })
/** The + and - buttons: a step of 1.5 times either way. */
const ZOOM_STEP = 1.5

/** Tell main how big the window is; no zone known measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && world.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('minimap:resize', { width: r.width, height: r.height })
}
watch([world, () => cfg.value.size, () => cfg.value.collapsed, () => legend.value.length], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div
        v-if="world"
        class="m-1.5 overflow-hidden rounded-lg border border-card bg-darker shadow-card"
        :style="{ width: `${cfg.size}px`, opacity: cfg.opacity }"
      >
        <header class="flex cursor-move items-center gap-1.5 px-2 py-1 text-[11px]" title="Drag to move" @pointerdown="drag.onPointerDown">
          <span class="truncate font-semibold text-dark">{{ world.name }}</span>
          <span class="flex-1" />
          <span v-if="store.cubes.length" class="shrink-0 rounded-full bg-yellow/15 px-1.5 font-semibold text-yellow">
            {{ store.cubes.length }} cube{{ store.cubes.length > 1 ? 's' : '' }}
          </span>
          <span v-if="!store.nearby.position && !cfg.collapsed" class="shrink-0 text-darkest">where you are: unknown</span>
          <CollapseButton :collapsed="cfg.collapsed" class="-my-0.5 -mr-1" @toggle="toggleCollapsed" />
        </header>
        <template v-if="!cfg.collapsed">
        <div class="relative" :style="{ height: `${cfg.size}px` }">
          <div class="absolute right-1.5 top-1.5 z-10 flex flex-col overflow-hidden rounded-md border border-black/40 bg-black/60 text-white shadow">
            <button
              type="button"
              class="flex size-6 items-center justify-center hover:bg-white/15 disabled:opacity-40"
              title="Zoom in"
              :disabled="cfg.zoom >= 40"
              @pointerdown.stop
              @dblclick.stop
              @click="setZoom(cfg.zoom * ZOOM_STEP)"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center border-t border-white/15 hover:bg-white/15 disabled:opacity-40"
              title="Zoom out"
              :disabled="cfg.zoom <= 1"
              @pointerdown.stop
              @dblclick.stop
              @click="setZoom(cfg.zoom / ZOOM_STEP)"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M3.5 8h9" />
              </svg>
            </button>
          </div>
          <WorldMap
            :world="world"
            :layers="layers"
            :focus="NO_FOCUS"
            :you="store.nearby.position"
            :cubes="cubes"
            :follow="cfg.zoom"
            :hint="false"
            class="!rounded-none"
            @zoom="setZoom"
          />
        </div>
        <div v-if="legend.length" class="flex flex-wrap gap-x-2 gap-y-1 px-2 py-1.5">
          <span v-for="t in legend" :key="t.id" class="flex min-w-0 items-center gap-1 text-[11px] text-dark" :title="displayName(pet(t.id))">
            <span class="size-2 shrink-0 rounded-full" :style="{ background: t.color }" />
            <PetIcon :id="t.id" :size="14" />
            <span class="max-w-[88px] truncate">{{ displayName(pet(t.id)) }}</span>
          </span>
        </div>
        </template>
      </div>
    </div>
  </div>
</template>
