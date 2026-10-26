<script setup lang="ts">
// Pets: every pet with its souls and level, as a table. Search, filter and sort; click a pet for
// where its souls drop, a name or a soul count to correct it; the pin puts a pet on the HUD (in
// pinned mode) and on the maps.
import { computed, nextTick, onBeforeUnmount, ref, toRefs } from 'vue'
import GenusPill, { GENUS_PILL } from '@/components/GenusPill.vue'
import LevelBadge from '@/components/LevelBadge.vue'
import LevelBar from '@/components/LevelBar.vue'
import PetIcon from '@/components/PetIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Segmented from '@/components/ui/Segmented.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { bridge } from '@/lib/bridge.ts'
import { plural, t } from '@/lib/i18n.ts'
import { CONTINENTS, formatDistance, nearbyPets, petContinents, petDistance, petWorlds, useSpawns, type NearbyPet } from '@/lib/spawns.ts'
import { displayName, GENERA, GENUS_LABEL, monsterName, PET_DB_DATE, PET_DB_SIZE, PET_DB_SOURCE, petInfo, type Genus } from '@/lib/petDb.ts'
import { useApp } from '@/stores/app.ts'
import { blankPet, MAX_LEVEL, nextLevelSouls, type Pet } from '@shared/tracker.ts'
import { MAX_PINNED, type Settings } from '@shared/settings.ts'

const store = useApp()
// In the store, so they survive the tab being rebuilt (after a pet's map closes).
const { query, sort, filter, genus, continent } = toRefs(store.collectionView)

const SORTS = [
  { id: 'souls', label: 'Most souls' },
  { id: 'level', label: 'Level' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'This session' },
  { id: 'range', label: 'Nearest spawn' },
] as const
/** What the HUD lists below Nearby (Settings → HUD), switched from here too. */
const HUD_MODES: { id: Settings['hud']['mode']; label: string }[] = [
  { id: 'recent', label: 'HUD: this session' },
  { id: 'pinned', label: 'HUD: pinned' },
]

// Around you: the pets whose soul monsters the tracker sees loaded near you.
const spawns = useSpawns()

/** The continents each pet's soul monsters spawn on (Elyos, Asmodian, Abyss). */
const continents = computed(() => (spawns.value ? petContinents(spawns.value) : new Map<number, Set<string>>()))
const onContinent = (id: number): boolean => !continent.value || !!continents.value.get(id)?.has(continent.value)
/** The zones each pet's soul monsters spawn in. */
const worlds = computed(() => (spawns.value ? petWorlds(spawns.value) : new Map<number, Set<number>>()))
/**
 * With a continent chosen: for a pet whose souls drop there only, where they drop. Elyos or
 * Asmodian: none on the other side ("only in Altgard"; the Abyss as well is fine). Abyss: one zone
 * of it, whatever the pet drops outside the Abyss ("only in Chaotic Middle Reshanta", not open to
 * everyone yet).
 */
const onlyZone = (id: number): string | null => {
  const data = spawns.value
  const side = continent.value
  if (!data || !side) return null
  const groups = continents.value.get(id) ?? new Set<string>()
  const names = [...(worlds.value.get(id) ?? [])].filter((w) => data.worlds[w]?.group === side).map((w) => data.worlds[w]!.name)
  if (side === 'abyss') return names.length === 1 ? names[0]! : null
  if (groups.has(side === 'elyos' ? 'asmodians' : 'elyos')) return null
  return names.length ? names.join(' & ') : null
}
const ofGenus = (id: number): boolean => !genus.value || petInfo(id)?.genus === genus.value

/** Pets per genus on the chosen continent, for the genus chips. */
const genusCounts = computed(() => {
  const counts = new Map<Genus, number>()
  for (const p of store.pets) {
    const g = petInfo(p.id)?.genus
    if (g && onContinent(p.id)) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return counts
})
/** Pets per continent of the chosen genus, for the continent chips. */
const continentCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const p of store.pets) {
    if (!ofGenus(p.id)) continue
    for (const c of continents.value.get(p.id) ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return counts
})

/**
 * Range: how far your last known position is from each pet's nearest soul monster spawn in your
 * zone. The tracker learns the position on entering a zone, teleporting, and from your own skills;
 * null for a pet with no spawns in your zone, or while the position is not known.
 */
const here = computed(() =>
  store.nearby.world !== null && store.nearby.position ? { world: store.nearby.world, at: store.nearby.position } : null,
)
// How old the position is, said the way people do; ticks so it ages while the panel is open.
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 15_000)
onBeforeUnmount(() => clearInterval(ticker))
const positionAge = computed(() => {
  const at = store.nearby.positionAt
  if (!at) return t('as last seen')
  const min = Math.floor((now.value - at) / 60_000)
  return min < 1 ? t('updated just now') : min < 60 ? t('updated {n} min ago', { n: min }) : t('updated {n} h ago', { n: Math.floor(min / 60) })
})
const distance = (id: number): number | null =>
  spawns.value && here.value ? petDistance(spawns.value, id, here.value.world, here.value.at) : null
const near = computed(
  () =>
    new Map<number, NearbyPet>(
      (spawns.value ? nearbyPets(store.nearby, spawns.value) : []).filter((n) => !store.hiddenPet(n.pet)).map((n) => [n.pet, n]),
    ),
)
/** The soul monsters around you, by name: what you actually see in the game. */
const nearMonsters = computed(() => {
  const seen = new Map<number, { name: string; count: number }>()
  for (const n of near.value.values()) for (const m of n.monsters) seen.set(m.npc, { name: m.name, count: m.count })
  return [...seen.values()].sort((a, b) => b.count - a.count)
})
const nearLine = (n: NearbyPet): string =>
  n.monsters.map((m) => `${m.count > 1 ? `${m.count}× ` : ''}${m.name} (Lv${m.level})`).join(', ')

const pinned = computed(() => new Set(store.settings.hud.pinned))
const pinsFull = computed(() => pinned.value.size >= MAX_PINNED)
const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  // A pet nearby that the collection has never seen (no souls yet) still belongs in the list.
  const known = new Set(store.pets.map((p) => p.id))
  const unseen: Pet[] = [...near.value.keys()]
    .filter((id) => !known.has(id))
    .map((id) => blankPet(id))
  let out = [...store.pets, ...(filter.value === 'nearby' ? unseen : [])].filter((p) => {
    // Maxed pets are left out when the setting says so, unless searched for by name.
    if (!q && store.hiddenPet(p.id)) return false
    if (filter.value === 'nearby' && !near.value.has(p.id)) return false
    if (filter.value === 'pinned' && !pinned.value.has(p.id)) return false
    if (filter.value === 'unfinished' && p.level >= MAX_LEVEL) return false
    if (filter.value === 'session' && !p.session) return false
    const info = petInfo(p.id)
    if (!ofGenus(p.id) || !onContinent(p.id)) return false
    if (!q) return true
    const haystack = [displayName(p), p.name ?? '', info ? GENUS_LABEL[info.genus] : '', String(p.id)]
    return haystack.some((h) => h.toLowerCase().includes(q))
  })
  const by: Record<typeof sort.value, (a: Pet, b: Pet) => number> = {
    souls: (a, b) => b.souls - a.souls,
    name: (a, b) => displayName(a).localeCompare(displayName(b)),
    level: (a, b) => b.level - a.level || b.souls - a.souls,
    recent: (a, b) => b.session - a.session || b.souls - a.souls,
    // Nearest first; pets with no spawn in your zone after them, by souls.
    range: (a, b) => {
      const da = distance(a.id)
      const db = distance(b.id)
      if (da !== null && db !== null) return da - db
      return (da === null ? 1 : 0) - (db === null ? 1 : 0) || b.souls - a.souls
    },
  }
  const nearFirst = (a: Pet, b: Pet): number =>
    filter.value === 'nearby' ? (near.value.get(b.id)?.count ?? 0) - (near.value.get(a.id)?.count ?? 0) : 0
  out = [...out].sort((a, b) => nearFirst(a, b) || by[sort.value](a, b) || a.id - b.id)
  return out
})
const hiddenCount = computed(() => (query.value.trim() ? 0 : store.pets.filter((p) => store.hiddenPet(p.id)).length))
const totals = computed(() => ({
  pets: store.pets.length,
  souls: store.pets.reduce((n, p) => n + p.souls, 0),
  maxed: store.pets.filter((p) => p.level >= MAX_LEVEL).length,
}))

// Inline editing: one field at a time.
const editing = ref<{ id: number; field: 'name' | 'souls'; value: string } | null>(null)
const input = ref<HTMLInputElement[] | null>(null)
async function edit(pet: Pet, field: 'name' | 'souls'): Promise<void> {
  editing.value = { id: pet.id, field, value: field === 'name' ? (pet.name ?? '') : String(pet.souls) }
  await nextTick()
  input.value?.[0]?.select()
}
function commit(): void {
  const e = editing.value
  editing.value = null
  if (!e) return
  if (e.field === 'souls') {
    const n = Number(e.value)
    if (Number.isInteger(n) && n >= 0) void bridge().invoke('tracker:setSouls', e.id, n)
  } else if (e.value.trim()) {
    void bridge().invoke('tracker:setName', e.id, e.value.trim())
  }
}

/** What to show, with how many: the nearby count is the live one. */
const FILTERS = computed(() => [
  { id: 'all' as const, label: 'All' },
  { id: 'unfinished' as const, label: t('Below Lv{n}', { n: MAX_LEVEL }) },
  { id: 'session' as const, label: 'This session' },
  { id: 'pinned' as const, label: 'Pinned', count: pinned.value.size },
  { id: 'nearby' as const, label: 'Nearby', count: near.value.size },
])

const syncedAgo = computed(() => {
  const s = store.status?.synced
  if (!s) return null
  const min = Math.round((Date.now() - s.at) / 60000)
  return min < 1 ? t('just now') : t('{n} min ago', { n: min })
})
</script>

<template>
  <div>
    <PageHeader title="Pets" about="Every pet with its level and souls. Click one for where its souls drop; pin the ones you are farming to see them on the HUD and the maps." />

    <div
      v-if="!store.status?.synced && store.pets.every((p) => p.levelEstimated)"
      class="mb-4 rounded-xl border border-accent/40 bg-accent-soft/60 px-4 py-2.5 text-sm text-dark"
    >
      {{ t('Counts load from the server when you enter the world. Log in (or go to character select and back) while the tracker runs to sync every pet.') }}
    </div>

    <div class="mb-4 grid grid-cols-4 gap-3">
      <div class="rounded-xl border border-card bg-card px-4 py-3">
        <div class="text-xs text-darker">Pets</div>
        <div class="text-2xl font-semibold tabular-nums">{{ totals.pets }}</div>
      </div>
      <div class="rounded-xl border border-card bg-card px-4 py-3">
        <div class="text-xs text-darker">Souls</div>
        <div class="text-2xl font-semibold tabular-nums">{{ totals.souls }}</div>
      </div>
      <div class="rounded-xl border border-card bg-card px-4 py-3">
        <div class="text-xs text-darker">{{ t('At Lv{n}', { n: MAX_LEVEL }) }}</div>
        <div class="text-2xl font-semibold tabular-nums">{{ totals.maxed }}</div>
      </div>
      <div class="rounded-xl border border-card bg-card px-4 py-3">
        <div class="text-xs text-darker">{{ t('This session') }}</div>
        <div class="text-2xl font-semibold tabular-nums text-green">+{{ store.sessionSouls }}</div>
      </div>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <Segmented v-model="filter" :options="FILTERS" size="sm" />
      <input
        v-model="query"
        type="search"
        :placeholder="t('Search pets, monsters, genus or #id')"
        class="ml-auto h-8 w-64 rounded-md border border-light bg-default px-2.5 text-sm placeholder:text-darkest focus:border-accent"
      />
      <SelectBox v-model="sort" :options="SORTS" />
      <SelectBox
        :model-value="store.settings.hud.mode"
        :options="HUD_MODES"
        :title="t('What the HUD lists below Nearby')"
        @update:model-value="store.setHud({ mode: $event })"
      />
    </div>
    <div class="mb-4 flex flex-wrap items-center gap-1.5">
      <button
        v-for="g in GENERA"
        :key="g.id"
        type="button"
        :class="['rounded-full border px-2.5 py-0.5 text-xs transition', genus === g.id ? GENUS_PILL[g.id] : 'border-light text-darker hover:text-default']"
        @click="genus = genus === g.id ? null : g.id"
      >
        {{ g.label }} <span class="tabular-nums opacity-60">{{ genusCounts.get(g.id) ?? 0 }}</span>
      </button>
      <span class="mx-1 h-4 w-px bg-light" />
      <button
        v-for="c in CONTINENTS"
        :key="c.id"
        type="button"
        :class="['rounded-full border px-2.5 py-0.5 text-xs transition', continent === c.id ? 'border-accent bg-accent-soft text-accent' : 'border-light text-darker hover:text-default']"
        :title="c.label === 'Abyss' ? t('Pets whose soul monsters spawn in the Abyss') : t('Pets whose soul monsters spawn in {side} zones', { side: c.label })"
        @click="continent = continent === c.id ? null : c.id"
      >
        {{ c.label }} <span class="tabular-nums opacity-60">{{ continentCounts.get(c.id) ?? 0 }}</span>
      </button>
      <span v-if="filter === 'nearby' && nearMonsters.length" class="ml-auto truncate text-xs text-green">
        {{ nearMonsters.slice(0, 4).map((m) => `${m.name} ${m.count}`).join(' · ') }}
      </span>
    </div>
    <p v-if="sort === 'range'" class="-mt-2 mb-3 text-xs text-darkest">
      <template v-if="here">{{ t('Distance from your position in {zone} ({age}) to each pet\'s nearest spawn there.', { zone: spawns?.worlds[here.world]?.name ?? t('this zone'), age: positionAge }) }}</template>
      <template v-else>{{ t('Nearest spawn needs your position: it is read as you enter a zone, and follows you from then on.') }}</template>
    </p>

    <div class="overflow-hidden rounded-xl border border-card">
      <table class="w-full text-sm">
        <thead class="bg-card text-xs uppercase tracking-wide text-darker">
          <tr class="border-b border-card">
            <th class="py-2.5 pl-4 text-left font-medium">Pet</th>
            <th class="w-24 px-3 text-right font-medium">Souls</th>
            <th class="w-72 px-3 text-left font-medium">{{ t('Level') }}</th>
            <th class="w-12 pr-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--line)]">
          <tr v-for="pet in list" :key="pet.id" class="group cursor-pointer hover:bg-card" :title="t('Show where its souls drop')" @click="store.openPet(pet.id)">
            <td class="py-2 pl-4">
              <div class="flex items-center gap-3">
                <PetIcon :id="pet.id" :size="36" />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <input
                      v-if="editing?.id === pet.id && editing.field === 'name'"
                      ref="input"
                      v-model="editing.value"
                      class="h-6 w-56 rounded border border-accent bg-default px-1.5 text-sm"
                      :placeholder="t('Monster name')"
                      @click.stop
                      @keydown.enter="commit"
                      @keydown.esc.stop="editing = null"
                      @blur="commit"
                    />
                    <template v-else>
                      <span v-if="petInfo(pet.id)" class="truncate font-medium" :title="`Pet #${pet.id}`">{{ displayName(pet) }}</span>
                      <button
                        v-else
                        type="button"
                        :class="['truncate text-left', pet.name ? 'font-medium' : 'italic text-darker']"
                        :title="t('Not in the pet database: click to name it')"
                        @click.stop="edit(pet, 'name')"
                      >
                        {{ displayName(pet) }}
                      </button>
                      <GenusPill :id="pet.id" />
                      <span v-if="onlyZone(pet.id)" class="shrink-0 whitespace-nowrap rounded border border-light px-1.5 text-[10px] text-darker">
                        {{ t('only in {zone}', { zone: onlyZone(pet.id)! }) }}
                      </span>
                    </template>
                  </div>
                  <div v-if="near.get(pet.id)" class="truncate text-xs text-green" :title="nearLine(near.get(pet.id)!)">{{ t('nearby: {list}', { list: nearLine(near.get(pet.id)!) }) }}</div>
                  <div v-else-if="monsterName(pet) || (sort === 'range' && distance(pet.id) !== null)" class="truncate text-xs text-darkest">
                    <template v-if="sort === 'range' && distance(pet.id) !== null">{{ t('{d} away', { d: formatDistance(distance(pet.id)!) }) }}</template>
                    <template v-if="sort === 'range' && distance(pet.id) !== null && monsterName(pet)"> · </template>
                    <template v-if="monsterName(pet)">{{ t('from {name}', { name: monsterName(pet)! }) }}</template>
                  </div>
                </div>
              </div>
            </td>
            <td class="px-3 text-right">
              <input
                v-if="editing?.id === pet.id && editing.field === 'souls'"
                ref="input"
                v-model="editing.value"
                inputmode="numeric"
                class="h-6 w-16 rounded border border-accent bg-default px-1.5 text-right text-sm tabular-nums"
                @click.stop
                @keydown.enter="commit"
                @keydown.esc.stop="editing = null"
                @blur="commit"
              />
              <button v-else type="button" class="font-semibold tabular-nums hover:text-accent" :title="t('Click to correct the count')" @click.stop="edit(pet, 'souls')">
                {{ pet.souls }}
              </button>
              <div v-if="pet.session" class="text-xs tabular-nums text-green">+{{ pet.session }}</div>
            </td>
            <td class="px-3">
              <div class="flex items-center gap-2">
                <LevelBadge :pet="pet" />
                <LevelBar :pet="pet" class="flex-1" />
                <span class="w-14 shrink-0 text-right text-[11px] tabular-nums text-darkest">
                  <template v-if="nextLevelSouls(pet) !== null">{{ pet.souls }}/{{ nextLevelSouls(pet) }}</template>
                  <template v-else>max{{ pet.crystals ? ` · ${pet.crystals}` : '' }}</template>
                </span>
              </div>
            </td>
            <td class="pr-3 text-right">
              <button
                type="button"
                :title="pinned.has(pet.id) ? t('Unpin from the HUD') : pinsFull ? t('{n} pets pinned already: unpin one first', { n: MAX_PINNED }) : t('Pin to the HUD')"
                :disabled="!pinned.has(pet.id) && pinsFull"
                :class="[
                  'inline-flex size-7 items-center justify-center rounded-md transition hover:bg-light disabled:cursor-not-allowed disabled:hover:bg-transparent',
                  pinned.has(pet.id) ? 'text-accent' : 'text-darkest opacity-0 hover:text-default group-hover:opacity-100',
                ]"
                @click.stop="store.togglePin(pet.id)"
              >
                <svg viewBox="0 0 16 16" class="size-3.5" :fill="pinned.has(pet.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.4">
                  <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z M8 8.5V14" stroke-linejoin="round" />
                </svg>
              </button>
            </td>
          </tr>
          <tr v-if="hiddenCount">
            <td colspan="4" class="px-4 py-2 text-center text-xs text-darkest">
              {{ plural(hiddenCount, '{n} maxed (Lv3) pet hidden: search finds them, or turn this off in Settings.', '{n} maxed (Lv3) pets hidden: search finds them, or turn this off in Settings.') }}
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="4" class="px-4 py-10 text-center text-sm text-darker">
              {{ store.pets.length ? t('No pets match.') : t('No pets yet: they appear when souls drop, or on the next login sync.') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-3 flex justify-between text-xs text-darkest">
      <span v-if="syncedAgo">{{ t('Synced from the server {when}', { when: syncedAgo }) }}</span>
      <span>
        {{ t('Pet names, genus and portraits:') }}
        <a :href="PET_DB_SOURCE" target="_blank" class="hover:text-default hover:underline">questlog.gg</a>
        ({{ t('{n} pets', { n: PET_DB_SIZE }) }}, {{ PET_DB_DATE }})
      </span>
    </p>
  </div>
</template>
