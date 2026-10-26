<script setup lang="ts">
// A fight's breakdown, questlog.gg's way: the players ranked, then the chosen one's card (rank,
// class, combat power; DPS, damage, contribution, time active) and tabs: Skills, Hits (crits, back
// attacks, perfect, double, multi-hits), Defense (damage taken, healing), Rotation (when each skill
// landed), Buffs (A2Tools DPS Meter's buff timeline, as its Details does) and Healing. From A2Tools
// DPS Meter's parser. Opened on the live target from a meter row (it follows the fight, redrawn
// every second), or on a saved fight from the History page. Moved by its header; its X closes it.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BuffIcon from '@/components/BuffIcon.vue'
import SkillIcon from '@/components/SkillIcon.vue'
import { buffName } from '@/lib/buffs.ts'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { CLASS_COLORS, type DetailsSkill, type DetailsView } from '@shared/meter.ts'
import { trackSegments, type BuffTrack } from '@shared/buffs.ts'

const LIVE_EVERY_MS = 1000
type Tab = 'skills' | 'hits' | 'defense' | 'rotation' | 'buffs' | 'healing'
const TABS: { id: Tab; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'hits', label: 'Hits' },
  { id: 'defense', label: 'Defense' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'buffs', label: 'Buffs' },
  { id: 'healing', label: 'Healing' },
]

const api = bridge()
const view = ref<DetailsView | null>(null)
const loading = ref(true)
/** The player whose card is shown; the one asked for, else the top one. */
const chosen = ref<number | null>(null)
const tab = ref<Tab>('skills')

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null =>
  className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null

function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const pct = (n: number, of: number): string => (of > 0 ? `${((n / of) * 100).toFixed(0)}%` : '-')

const live = computed(() => view.value?.source.kind === 'live')
const seconds = computed(() => Math.max(1, (view.value?.battleTime ?? 0) / 1000))
const ranked = computed(() => (view.value?.actors ?? []).filter((a) => a.damage > 0 || a.heal > 0))
const actor = computed(() => view.value?.actors.find((a) => a.id === chosen.value) ?? ranked.value[0] ?? null)
const rank = computed(() => (actor.value ? ranked.value.findIndex((a) => a.id === actor.value!.id) + 1 : 0))
const top = computed(() => Math.max(1, ...ranked.value.map((a) => a.damage)))
const color = (className: string | null): string => CLASS_COLORS[className ?? ''] ?? '#787b8a'

const skills = computed<DetailsSkill[]>(() => (view.value?.skills ?? []).filter((s) => s.actor === actor.value?.id))
const heals = computed<DetailsSkill[]>(() => (view.value?.heals ?? []).filter((s) => s.actor === actor.value?.id))
const skillTop = computed(() => Math.max(1, ...skills.value.map((s) => s.damage)))
const healTop = computed(() => Math.max(1, ...heals.value.map((s) => s.damage)))
/** When the player first and last hit: their time active. */
const active = computed(() => {
  const at = skills.value.flatMap((s) => s.at)
  return at.length ? Math.max(...at) - Math.min(...at) : null
})

// ---- Hits -----------------------------------------------------------------------------------
const hits = computed(() => {
  const sum = (k: keyof DetailsSkill): number => skills.value.reduce((n, s) => n + (s[k] as number), 0)
  return { hits: sum('hits'), crits: sum('crits'), back: sum('back'), perfect: sum('perfect'), double: sum('double'), parry: sum('parry'), multi: sum('multi') }
})
const HIT_CARDS = [
  { key: 'crits', label: 'Critical' },
  { key: 'back', label: 'Back attack' },
  { key: 'perfect', label: 'Perfect' },
  { key: 'double', label: 'Double' },
  { key: 'multi', label: 'Multi-hit' },
  { key: 'parry', label: 'Parried' },
] as const

// ---- Defense --------------------------------------------------------------------------------
const defense = computed(() => (actor.value && view.value?.defense ? (view.value.defense[actor.value.id] ?? null) : null))
const takenRanked = computed(() =>
  ranked.value
    .map((a) => ({ a, taken: view.value?.defense?.[a.id]?.taken ?? 0 }))
    .filter((r) => r.taken > 0)
    .sort((x, y) => y.taken - x.taken),
)
const takenTop = computed(() => Math.max(1, ...takenRanked.value.map((r) => r.taken)))

// ---- Rotation -------------------------------------------------------------------------------
/** Every hit in order, for the cast sequence: one per skill per 300 ms (a multi-hit is one cast). */
const sequence = computed(() => {
  const hitsAt = skills.value.filter((s) => !s.dot).flatMap((s) => s.at.map((t) => ({ t, code: s.code, name: s.name })))
  hitsAt.sort((a, b) => a.t - b.t)
  const out: typeof hitsAt = []
  const lastOf = new Map<number, number>()
  for (const h of hitsAt) {
    const last = lastOf.get(h.code)
    lastOf.set(h.code, h.t)
    if (last === undefined || h.t - last > 300) out.push(h)
  }
  return out
})
const lanes = computed(() => {
  const d = Math.max(1, view.value?.battleTime ?? 1)
  return [...skills.value]
    .filter((s) => s.at.length && !s.dot)
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 10)
    .map((s) => ({ s, marks: s.at.map((t) => Math.min(100, Math.max(0, (t / d) * 100))) }))
})

// ---- Buffs ----------------------------------------------------------------------------------
/** One buff row: a track, its name, who cast it, its bars (percent of the fight) and uptime. */
interface BuffRow {
  key: string
  track: BuffTrack
  name: string
  by: string | null
  bars: { left: number; width: number }[]
  uptime: number
}
const nameOf = (id: number): string | null => view.value?.actors.find((a) => a.id === id)?.name ?? null
function buffRows(tracks: BuffTrack[], showBy: boolean): BuffRow[] {
  const d = view.value?.buffs?.durationMs ?? 0
  if (d <= 0) return []
  return tracks
    .map((t, i) => ({
      key: `${t.on}-${t.id}-${t.by}-${i}`,
      track: t,
      name: buffName(t.id),
      by: showBy && t.by ? (t.by === view.value?.buffs?.targetId ? view.value.title : (nameOf(t.by) ?? null)) : null,
      bars: trackSegments(t, d).map(([a, b]) => ({ left: (a / d) * 100, width: Math.max(0.4, ((b - a) / d) * 100) })),
      uptime: Math.min(100, (t.up / d) * 100),
    }))
    .sort((a, b) => Number(a.track.passive ?? false) - Number(b.track.passive ?? false) || b.uptime - a.uptime)
}
/** On the chosen player (their summons' too), and on the target from anyone. */
const onActor = computed(() => buffRows((view.value?.buffs?.tracks ?? []).filter((t) => t.on === actor.value?.id && (showPassives.value || !t.passive)), true))
const onTarget = computed(() => buffRows((view.value?.buffs?.tracks ?? []).filter((t) => t.on === view.value?.buffs?.targetId && (showPassives.value || !t.passive)), true))
const showPassives = ref(false)
const started = computed(() =>
  view.value?.startedAt ? new Date(view.value.startedAt).toLocaleString(loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null,
)

async function load(): Promise<void> {
  const next = await api.invoke('details:get')
  loading.value = false
  if (!next) return
  const first = view.value === null || JSON.stringify(view.value.source) !== JSON.stringify(next.source)
  view.value = next
  if (first) chosen.value = next.source.actor ?? next.actors[0]?.id ?? null
}

const drag = windowDrag({ move: 'details:moveTo', end: 'details:dragEnd' })
const close = (): void => void api.invoke('details:close')

let timer: ReturnType<typeof setInterval> | null = null
let off: (() => void) | null = null
onMounted(() => {
  void load()
  off = api.on('details:source', () => {
    view.value = null
    loading.value = true
    void load()
  })
  // A live fight goes on: redrawn while the window is open.
  timer = setInterval(() => live.value && void load(), LIVE_EVERY_MS)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  off?.()
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden rounded-xl border border-card bg-darker shadow-card">
    <header class="flex cursor-move items-center gap-2 border-b border-card px-3 py-2" :title="t('Drag to move')" @pointerdown="drag.onPointerDown">
      <span v-if="live" class="size-1.5 shrink-0 rounded-full bg-green" :title="t('Live: follows the fight')" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-default">{{ view?.title ?? t('Details') }}</div>
        <div v-if="view" class="text-[11px] tabular-nums text-darker">
          {{ clock(view.battleTime) }} · {{ t('{n} damage', { n: short(view.totalDamage) }) }}<template v-if="view.maxHp"> {{ t('of {n} HP', { n: short(view.maxHp) }) }}</template
          ><template v-if="started"> · {{ started }}</template>
        </div>
      </div>
      <button type="button" class="flex size-6 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default" :title="t('Close')" @pointerdown.stop @click="close">
        <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" /></svg>
      </button>
    </header>

    <p v-if="!view" class="px-3 py-4 text-xs text-darker">{{ loading ? t('Loading…') : t('Nothing to show: the fight is gone, or the engine is not running.') }}</p>

    <template v-else>
      <!-- The players: click one for their card. -->
      <ul class="max-h-36 shrink-0 space-y-0.5 overflow-y-auto px-2 py-2">
        <li
          v-for="(a, i) in ranked"
          :key="a.id"
          :class="['relative cursor-pointer overflow-hidden rounded-md bg-dark', a.id === actor?.id ? 'ring-1 ring-accent' : 'hover:ring-1 hover:ring-light']"
          @click="chosen = a.id"
        >
          <div class="absolute inset-y-0 left-0 opacity-40" :style="{ width: `${(a.damage / top) * 100}%`, background: color(a.className) }" />
          <div class="relative flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
            <span class="w-4 text-right text-[10px] tabular-nums text-darker">{{ i + 1 }}</span>
            <img v-if="icon(a.className)" :src="icon(a.className)!" class="size-4 shrink-0" alt="" />
            <span v-else class="size-4 shrink-0" />
            <span :class="['min-w-0 flex-1 truncate font-medium', a.you ? 'text-accent' : a.enemy ? 'text-red' : 'text-default']">{{ a.name }}</span>
            <span class="w-14 text-right font-semibold tabular-nums">{{ short(a.dps) }}</span>
            <span class="w-11 text-right tabular-nums text-dark">{{ a.share.toFixed(1) }}%</span>
            <span class="w-14 text-right tabular-nums text-dark">{{ short(a.damage) }}</span>
          </div>
        </li>
      </ul>

      <!-- The chosen player's card. -->
      <div v-if="actor" class="shrink-0 border-t border-card px-3 pt-3">
        <div class="flex items-center gap-3">
          <img v-if="icon(actor.className)" :src="icon(actor.className)!" class="size-9 shrink-0" alt="" />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span :class="['truncate text-lg font-semibold', actor.you ? 'text-accent' : actor.enemy ? 'text-red' : 'text-default']">{{ actor.name }}</span>
              <span v-if="actor.you" class="rounded bg-accent/20 px-1.5 text-[10px] font-bold text-accent">ME</span>
            </div>
            <div class="text-xs text-darker">
              #{{ rank }} · {{ actor.className ?? t('Unknown class') }}<template v-if="actor.combatPower"> · {{ short(actor.combatPower) }}</template>
            </div>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-4 gap-2">
          <div class="rounded-lg bg-dark px-2.5 py-2">
            <div class="text-[10px] text-darker">DPS</div>
            <div class="text-base font-semibold tabular-nums">{{ short(actor.dps) }}</div>
          </div>
          <div class="rounded-lg bg-dark px-2.5 py-2">
            <div class="text-[10px] text-darker">{{ t('Damage') }}</div>
            <div class="text-base font-semibold tabular-nums">{{ short(actor.damage) }}</div>
          </div>
          <div class="rounded-lg bg-dark px-2.5 py-2">
            <div class="text-[10px] text-darker">{{ t('Contribution') }}</div>
            <div class="text-base font-semibold tabular-nums">{{ actor.share.toFixed(1) }}%</div>
          </div>
          <div class="rounded-lg bg-dark px-2.5 py-2">
            <div class="text-[10px] text-darker">{{ t('Active') }}</div>
            <div class="text-base font-semibold tabular-nums">{{ active !== null ? clock(active) : '-' }}<span class="text-xs font-normal text-darker"> / {{ clock(view.battleTime) }}</span></div>
          </div>
        </div>
        <nav class="mt-2 flex gap-4 border-b border-card text-sm">
          <button
            v-for="tb in TABS"
            :key="tb.id"
            type="button"
            :class="['-mb-px border-b-2 pb-1.5 pt-1', tab === tb.id ? 'border-accent font-medium text-default' : 'border-transparent text-darker hover:text-default']"
            @click="tab = tb.id"
          >{{ t(tb.label) }}</button>
        </nav>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-xs">
        <!-- Skills -->
        <template v-if="tab === 'skills'">
          <div class="flex items-center gap-2 px-1.5 pb-1 text-[10px] text-darkest">
            <span class="flex-1 pl-7">Skill</span><span class="w-14 text-right">{{ t('Damage') }}</span><span class="w-12 text-right">DPS</span><span class="w-10 text-right">Crit</span><span class="w-10 text-right">Hits</span><span class="w-12 text-right">Max</span>
          </div>
          <div v-for="s in skills" :key="`${s.code}-${s.dot}`" class="relative mb-0.5 overflow-hidden rounded-md bg-dark" :title="s.name">
            <div class="absolute inset-y-0 left-0 bg-danger/35" :style="{ width: `${(s.damage / skillTop) * 100}%` }" />
            <div class="relative flex items-center gap-2 px-1.5 py-1 tabular-nums">
              <SkillIcon :code="s.code" :size="20" />
              <span class="min-w-0 flex-1 truncate font-medium text-default">{{ s.name }}<span v-if="s.dot" class="ml-1 text-[10px] text-darker">DoT</span></span>
              <span class="w-14 text-right font-semibold">{{ short(s.damage) }}</span>
              <span class="w-12 text-right text-dark">{{ short(s.damage / seconds) }}</span>
              <span class="w-10 text-right text-dark">{{ pct(s.crits, s.hits) }}</span>
              <span class="w-10 text-right text-dark">{{ s.hits }}</span>
              <span class="w-12 text-right text-dark">{{ s.maxHit ? short(s.maxHit) : '-' }}</span>
            </div>
          </div>
          <p v-if="!skills.length" class="px-1.5 py-2 text-darker">{{ t('No damage by this player in this fight.') }}</p>
        </template>

        <!-- Hits -->
        <template v-else-if="tab === 'hits'">
          <div class="mb-3 grid grid-cols-3 gap-2 px-1">
            <div v-for="c in HIT_CARDS" :key="c.key" class="rounded-lg bg-dark px-2.5 py-2">
              <div class="text-[10px] text-darker">{{ t(c.label) }}</div>
              <div class="text-base font-semibold tabular-nums">{{ pct(hits[c.key], hits.hits) }}</div>
              <div class="text-[10px] tabular-nums text-darkest">{{ t('{n} of {total} hits', { n: hits[c.key], total: hits.hits }) }}</div>
            </div>
          </div>
          <table class="w-full tabular-nums">
            <thead class="text-[10px] text-darkest">
              <tr><th class="px-1.5 pb-1 text-left font-normal">Skill</th><th class="w-10 text-right font-normal">Hits</th><th class="w-10 text-right font-normal">Crit</th><th class="w-10 text-right font-normal">Back</th><th class="w-12 text-right font-normal">Perfect</th><th class="w-12 text-right font-normal">Double</th><th class="w-10 pr-1.5 text-right font-normal">Multi</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in skills" :key="`${s.code}-${s.dot}`" class="border-t border-card/60">
                <td class="max-w-0 px-1.5 py-1"><span class="flex min-w-0 items-center gap-1.5"><SkillIcon :code="s.code" :size="16" /><span class="truncate text-dark">{{ s.name }}</span></span></td>
                <td class="text-right text-dark">{{ s.hits }}</td>
                <td class="text-right text-darker">{{ pct(s.crits, s.hits) }}</td>
                <td class="text-right text-darker">{{ pct(s.back, s.hits) }}</td>
                <td class="text-right text-darker">{{ pct(s.perfect, s.hits) }}</td>
                <td class="text-right text-darker">{{ pct(s.double, s.hits) }}</td>
                <td class="pr-1.5 text-right text-darker">{{ pct(s.multi, s.hits) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Defense -->
        <template v-else-if="tab === 'defense'">
          <p v-if="!view.defense" class="px-1.5 py-2 text-darker">{{ t('Not recorded for this fight.') }}</p>
          <template v-else>
            <div class="mb-3 grid grid-cols-3 gap-2 px-1">
              <div class="rounded-lg bg-dark px-2.5 py-2">
                <div class="text-[10px] text-darker">{{ t('Damage taken') }}</div>
                <div class="text-base font-semibold tabular-nums">{{ short(defense?.taken ?? 0) }}</div>
                <div class="text-[10px] tabular-nums text-darkest">{{ short((defense?.taken ?? 0) / seconds) }} {{ t('per second') }}</div>
              </div>
              <div class="rounded-lg bg-dark px-2.5 py-2">
                <div class="text-[10px] text-darker">{{ t('Hits taken') }}</div>
                <div class="text-base font-semibold tabular-nums">{{ defense?.hitsTaken ?? 0 }}</div>
                <div class="text-[10px] tabular-nums text-darkest">{{ defense?.hitsTaken ? short((defense.taken ?? 0) / defense.hitsTaken) : '-' }} {{ t('a hit') }}</div>
              </div>
              <div class="rounded-lg bg-dark px-2.5 py-2">
                <div class="text-[10px] text-darker">{{ t('Healing done') }}</div>
                <div class="text-base font-semibold tabular-nums">{{ short(defense?.heal ?? actor?.heal ?? 0) }}</div>
                <div class="text-[10px] tabular-nums text-darkest">{{ short((defense?.heal ?? actor?.heal ?? 0) / seconds) }} {{ t('per second') }}</div>
              </div>
            </div>
            <div class="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">{{ t('Damage taken by player') }}</div>
            <div v-for="r in takenRanked" :key="r.a.id" class="relative mb-0.5 overflow-hidden rounded-md bg-dark">
              <div class="absolute inset-y-0 left-0 opacity-40" :style="{ width: `${(r.taken / takenTop) * 100}%`, background: color(r.a.className) }" />
              <div class="relative flex items-center gap-1.5 px-1.5 py-0.5">
                <img v-if="icon(r.a.className)" :src="icon(r.a.className)!" class="size-4 shrink-0" alt="" />
                <span :class="['min-w-0 flex-1 truncate', r.a.id === actor?.id ? 'font-semibold text-accent' : 'text-default']">{{ r.a.name }}</span>
                <span class="tabular-nums">{{ short(r.taken) }}</span>
              </div>
            </div>
            <p v-if="!takenRanked.length" class="px-1.5 text-darker">{{ t('Nobody took damage from this target.') }}</p>
          </template>
        </template>

        <!-- Rotation -->
        <template v-else-if="tab === 'rotation'">
          <p v-if="!sequence.length" class="px-1.5 py-2 text-darker">{{ t('No hit times for this player in this fight.') }}</p>
          <template v-else>
            <div class="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">{{ t('Opening: the first {n} casts', { n: Math.min(24, sequence.length) }) }}</div>
            <div class="mb-3 flex flex-wrap items-center gap-1 px-1.5">
              <template v-for="(h, i) in sequence.slice(0, 24)" :key="i">
                <span v-if="i" class="text-[9px] text-darkest">›</span>
                <span :title="t('{name} at {time}', { name: h.name, time: clock(h.t) })"><SkillIcon :code="h.code" :size="22" /></span>
              </template>
            </div>
            <div class="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">{{ t('Over the fight: each hit a mark') }}</div>
            <div v-for="l in lanes" :key="l.s.code" class="flex items-center gap-2 px-1.5 py-0.5" :title="`${l.s.name}: ${l.s.hits} hits`">
              <SkillIcon :code="l.s.code" :size="16" />
              <span class="w-28 shrink-0 truncate text-dark">{{ l.s.name }}</span>
              <div class="relative h-3 min-w-0 flex-1 rounded-sm bg-dark">
                <span v-for="(m, i) in l.marks" :key="i" class="absolute inset-y-0 w-px bg-accent" :style="{ left: `${m}%` }" />
              </div>
            </div>
            <div class="mt-1 flex justify-between pl-[9.5rem] pr-1.5 text-[10px] tabular-nums text-darkest"><span>0:00</span><span>{{ clock(view.battleTime) }}</span></div>
          </template>
        </template>

        <!-- Buffs -->
        <div v-else-if="tab === 'buffs'" class="px-1.5">
          <p v-if="!view.buffs" class="py-2 text-darker">{{ t('No buffs recorded for this fight (fights saved before buffs were recorded have none).') }}</p>
          <template v-else>
          <label class="mb-1.5 flex items-center gap-1.5 text-darker">
            <input v-model="showPassives" type="checkbox" class="accent-[color:var(--accent)]" />
            {{ t('Passives (on all fight)') }}
          </label>
          <section v-for="group in [{ title: t('On {name}', { name: actor?.name ?? t('the player') }), rows: onActor }, { title: t('On {name}', { name: view.title }), rows: onTarget }]" :key="group.title" class="mb-3">
            <h3 class="mb-1 font-semibold uppercase tracking-wide text-darkest">{{ group.title }}</h3>
            <p v-if="!group.rows.length" class="text-darker">{{ t('Nothing.') }}</p>
            <div v-for="r in group.rows" :key="r.key" class="flex items-center gap-2 py-0.5" :title="r.by ? t('{name} · from {by}', { name: r.name, by: r.by }) : r.name">
              <BuffIcon :id="r.track.id" :skill="r.track.skill" :size="16" />
              <span class="w-36 shrink-0 truncate text-dark">{{ r.name }}<span v-if="r.by && group.rows === onTarget" class="text-darkest"> · {{ r.by }}</span></span>
              <div class="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-dark">
                <div
                  v-for="(b, i) in r.bars"
                  :key="i"
                  :class="['absolute inset-y-0', r.track.by === actor?.id ? 'bg-accent' : group.rows === onTarget ? 'bg-danger/70' : 'bg-green/70']"
                  :style="{ left: `${b.left}%`, width: `${b.width}%` }"
                />
              </div>
              <span class="w-10 shrink-0 text-right tabular-nums text-darker">{{ r.uptime.toFixed(0) }}%</span>
            </div>
          </section>
          <p class="text-darkest">{{ t('Blue: cast by {name}. Green: by others. Red: on the target from others.', { name: actor?.name ?? t('the player') }) }}</p>
        </template>
        </div>

        <!-- Healing -->
        <template v-else>
          <div v-for="s in heals" :key="`${s.code}-${s.dot}`" class="relative mb-0.5 overflow-hidden rounded-md bg-dark" :title="s.name">
            <div class="absolute inset-y-0 left-0 bg-green/30" :style="{ width: `${(s.damage / healTop) * 100}%` }" />
            <div class="relative flex items-center gap-2 px-1.5 py-1 tabular-nums">
              <SkillIcon :code="s.code" :size="20" />
              <span class="min-w-0 flex-1 truncate font-medium text-default">{{ s.name }}<span v-if="s.dot" class="ml-1 text-[10px] text-darker">HoT</span></span>
              <span class="w-14 text-right font-semibold">{{ short(s.damage) }}</span>
              <span class="w-12 text-right text-dark">{{ short(s.damage / seconds) }}/s</span>
              <span class="w-10 text-right text-dark">{{ s.hits }}</span>
            </div>
          </div>
          <p v-if="!heals.length" class="px-1.5 py-2 text-darker">{{ t('No healing by this player in this fight.') }}</p>
        </template>
      </div>
    </template>
  </div>
</template>
