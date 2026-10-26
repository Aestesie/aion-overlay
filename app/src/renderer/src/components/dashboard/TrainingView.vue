<script setup lang="ts">
// Training Dummy (questlog.gg's page): runs on a training dummy against the clock or to a damage
// goal; only your own damage counts. With auto-start on, a run starts by itself with your first hit
// on a dummy (its clock with it); the Training overlay starts and stops them over the game too.
// Each run is saved with its skills; open one for its skills' DPS, or its Details for the whole
// breakdown (hits, rotation, buffs...), or tick two to compare them (DPS, damage, crits, hits, and
// skill by skill). Runs are kept in groups: "New group" starts the next.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import SkillIcon from '@/components/SkillIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Segmented from '@/components/ui/Segmented.vue'
import Toggle from '@/components/Toggle.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, plural, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { DUMMY_DAMAGE_GOALS, DUMMY_LIMITS, NO_DUMMY, nextRunName, type DummyGoal, type DummyRun, type DummyState } from '@shared/dummy.ts'

const api = bridge()
const store = useApp()
const cfg = computed(() => store.settings.dummy)
const set = (patch: Partial<typeof cfg.value>): void => void store.set('dummy', { ...cfg.value, ...patch })
const state = ref<DummyState>(structuredClone(NO_DUMMY))
const name = ref('')
const picked = ref<string[]>([])
/** The run whose skills are shown under it. */
const expanded = ref<string | null>(null)
const seconds = (r: DummyRun): number => Math.max(1, r.durationMs / 1000)
/** A run's skills: DPS, share, hits, crit rate and the average hit. */
const skillRows = (r: DummyRun) =>
  r.skills.map((s) => ({
    ...s,
    key: `${s.code}-${s.dot}`,
    dps: s.damage / seconds(r),
    share: r.damage ? (s.damage / r.damage) * 100 : 0,
    critRate: s.hits ? (s.crits / s.hits) * 100 : 0,
    avg: s.hits ? s.damage / s.hits : 0,
  }))
const openDetails = (r: DummyRun): void => void api.invoke('details:open', { kind: 'run', id: r.id })
// The clock, between the run's updates.
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => clearInterval(ticker))

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
const when = (ms: number): string => new Date(ms).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const inGroup = computed(() => state.value.runs.filter((r) => r.group === state.value.group).length)
const placeholder = computed(() => nextRunName(state.value))
const active = computed(() => state.value.active)
const elapsed = computed(() => {
  const a = active.value
  if (!a?.startedAt) return 0
  return Math.max(a.elapsedMs, now.value - a.startedAt)
})
const progress = computed(() => {
  const a = active.value
  if (!a) return 0
  if (a.goal === 'time') return a.limitMs ? Math.min(1, elapsed.value / a.limitMs) : 0
  return a.damageGoal ? Math.min(1, a.damage / a.damageGoal) : 0
})
const goalText = (r: { goal: DummyGoal; limitMs: number | null; damageGoal: number | null }): string =>
  r.goal === 'time' ? (r.limitMs ? t('{time} on the clock', { time: clock(r.limitMs) }) : t('Until stopped')) : t('{n} damage', { n: short(r.damageGoal ?? 0) })

const groups = computed(() => {
  const by = new Map<number, DummyRun[]>()
  for (const r of state.value.runs) by.set(r.group, [...(by.get(r.group) ?? []), r])
  return [...by.entries()].sort((a, b) => b[0] - a[0])
})
function pick(id: string): void {
  picked.value = picked.value.includes(id) ? picked.value.filter((p) => p !== id) : [...picked.value, id].slice(-2)
}
const compared = computed(() => {
  const [a, b] = picked.value.map((id) => state.value.runs.find((r) => r.id === id)).filter((r): r is DummyRun => !!r)
  if (!a || !b) return null
  // Older first: the change is from the first run to the second.
  const [x, y] = a.at <= b.at ? [a, b] : [b, a]
  const codes = [...new Set([...x.skills, ...y.skills].map((s) => `${s.code}-${s.dot}`))]
  const skills = codes
    .map((key) => {
      const sx = x.skills.find((s) => `${s.code}-${s.dot}` === key)
      const sy = y.skills.find((s) => `${s.code}-${s.dot}` === key)
      const s = (sx ?? sy)!
      return { key, code: s.code, name: s.name, dot: s.dot, a: (sx?.damage ?? 0) / seconds(x), b: (sy?.damage ?? 0) / seconds(y) }
    })
    .sort((p, q) => Math.max(q.a, q.b) - Math.max(p.a, p.b))
  return { x, y, skills }
})
const change = (a: number, b: number): string => (a > 0 ? `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%` : '')

function start(): void {
  void api.invoke('dummy:start', name.value.trim() || undefined)
  name.value = ''
}

let off: (() => void) | null = null
onMounted(async () => {
  off = api.on('dummy:state', (s) => (state.value = s))
  state.value = await api.invoke('dummy:get')
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div>
    <PageHeader title="Training Dummy" about="Runs on a training dummy, against the clock or to a damage goal; only your own damage counts. Compare two runs to see what changed." />

    <div class="mb-6 rounded-xl border border-card bg-card px-4 py-4">
      <div v-if="!active" class="flex flex-wrap items-end gap-4">
        <label class="block">
          <span class="text-xs text-darker">{{ t('Name') }}</span>
          <input v-model="name" :placeholder="placeholder" class="mt-1 block h-9 w-56 rounded-md border border-light bg-default px-2.5 text-sm placeholder:text-darkest focus:border-accent" @keydown.enter="start" />
        </label>
        <div>
          <div class="mb-1 text-xs text-darker">{{ t('Goal') }}</div>
          <Segmented :model-value="cfg.goal" :options="[{ id: 'time' as DummyGoal, label: 'Time' }, { id: 'damage' as DummyGoal, label: 'Damage' }]" @update:model-value="set({ goal: $event })" />
        </div>
        <div v-if="cfg.goal === 'time'">
          <div class="mb-1 text-xs text-darker">{{ t('Time limit') }}</div>
          <Segmented :model-value="cfg.limitMs" :options="DUMMY_LIMITS" @update:model-value="set({ limitMs: $event })" />
        </div>
        <div v-else>
          <div class="mb-1 text-xs text-darker">{{ t('Damage goal') }}</div>
          <Segmented :model-value="cfg.damageGoal" :options="DUMMY_DAMAGE_GOALS.map((d) => ({ id: d, label: short(d) }))" @update:model-value="set({ damageGoal: $event })" />
        </div>
        <div class="flex gap-2">
          <Button intent="primary" @click="start">{{ t('Start run') }}</Button>
          <Button :disabled="!inGroup" :title="t('Runs from now on are compared among themselves')" @click="api.invoke('dummy:newGroup')">{{ t('New group') }}</Button>
        </div>
        <div class="flex w-full flex-wrap items-center gap-x-6 gap-y-2 border-t border-card pt-3 text-sm">
          <label class="flex items-center gap-2" :title="t('No need to press Start: hitting a training dummy starts a run, and its clock, at once')">
            <Toggle :model-value="cfg.autoStart" @update:model-value="set({ autoStart: $event })" />
            {{ t('Start on my first hit on a dummy') }}
          </label>
          <label class="flex items-center gap-2" :title="t('A small panel over the game while you train: the clock, your DPS, start and stop')">
            <Toggle :model-value="cfg.overlay" @update:model-value="set({ overlay: $event })" />
            {{ t('Training overlay over the game') }}
          </label>
          <span class="text-xs text-darker">
            {{ inGroup ? plural(inGroup, 'Group {g} has {n} run.', 'Group {g} has {n} runs.', { g: state.group }) : t('{name} starts a new group.', { name: placeholder }) }}
          </span>
        </div>
      </div>
      <div v-else>
        <div class="flex items-center gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-base font-semibold">
              <span :class="['size-2 rounded-full', active.startedAt ? 'animate-pulse bg-danger' : 'bg-yellow']" />
              {{ active.name }}
              <span class="text-xs font-normal text-darker">· {{ goalText(active) }}</span>
            </div>
            <div class="text-xs text-darker">{{ active.startedAt ? t('Running: keep hitting the dummy.') : t('Hit a training dummy: the clock starts with your first hit.') }}</div>
          </div>
          <div class="text-right">
            <div class="text-2xl font-bold tabular-nums">{{ short(active.dps) }}<span class="ml-1 text-xs font-normal text-darker">DPS</span></div>
            <div class="text-xs tabular-nums text-darker">{{ clock(elapsed) }} · {{ t('{n} damage', { n: short(active.damage) }) }}</div>
          </div>
          <Button intent="primary" :disabled="!active.startedAt" @click="api.invoke('dummy:stop', true)">{{ t('Stop and save') }}</Button>
          <Button @click="api.invoke('dummy:stop', false)">{{ t('Cancel') }}</Button>
        </div>
        <div v-if="progress > 0 || (active.goal === 'time' && active.limitMs) || active.goal === 'damage'" class="mt-3 h-1.5 overflow-hidden rounded-full bg-dark">
          <div class="h-full bg-accent transition-[width]" :style="{ width: `${progress * 100}%` }" />
        </div>
      </div>
    </div>

    <!-- Two runs side by side. -->
    <section v-if="compared" class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">{{ compared.x.name }} → {{ compared.y.name }}</h2>
      <div class="mb-3 grid grid-cols-5 gap-2">
        <div v-for="c in [
          { label: 'DPS', a: compared.x.dps, b: compared.y.dps, f: short },
          { label: 'Damage', a: compared.x.damage, b: compared.y.damage, f: short },
          { label: 'Crit rate', a: compared.x.critRate * 100, b: compared.y.critRate * 100, f: (n: number) => `${n.toFixed(1)}%` },
          { label: 'Time', a: compared.x.durationMs, b: compared.y.durationMs, f: clock },
          { label: 'Hits', a: compared.x.skills.reduce((n, s) => n + s.hits, 0), b: compared.y.skills.reduce((n, s) => n + s.hits, 0), f: (n: number) => String(n) },
        ]" :key="c.label" class="rounded-xl border border-card bg-card px-3 py-2.5">
          <div class="text-xs text-darker">{{ t(c.label) }}</div>
          <div class="text-lg font-semibold tabular-nums">{{ c.f(c.a) }} <span class="text-darkest">→</span> {{ c.f(c.b) }}</div>
          <div :class="['text-xs tabular-nums', c.b >= c.a ? 'text-green' : 'text-danger']">{{ change(c.a, c.b) }}</div>
        </div>
      </div>
      <div class="overflow-hidden rounded-xl border border-card">
        <table class="w-full text-sm">
          <thead class="bg-card text-xs uppercase tracking-wide text-darker">
            <tr class="border-b border-card">
              <th class="py-2 pl-4 text-left font-medium">Skill DPS</th>
              <th class="w-28 px-3 text-right font-medium">{{ compared.x.name }}</th>
              <th class="w-28 px-3 text-right font-medium">{{ compared.y.name }}</th>
              <th class="w-24 pr-4 text-right font-medium">{{ t('Change') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[color:var(--line)]">
            <tr v-for="s in compared.skills" :key="s.key">
              <td class="py-1.5 pl-4"><span class="flex items-center gap-2"><SkillIcon :code="s.code" :size="20" />{{ s.name }}<span v-if="s.dot" class="text-xs text-darker">DoT</span></span></td>
              <td class="px-3 text-right tabular-nums text-darker">{{ s.a ? short(s.a) : '-' }}</td>
              <td class="px-3 text-right tabular-nums">{{ s.b ? short(s.b) : '-' }}</td>
              <td :class="['pr-4 text-right tabular-nums', s.b >= s.a ? 'text-green' : 'text-danger']">{{ s.a && s.b ? change(s.a, s.b) : s.b ? t('new') : t('gone') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="mb-2 flex items-baseline gap-2">
        <h2 class="text-base font-semibold">Runs</h2>
        <span class="text-xs text-darker">{{ t('Tick two runs to compare them.') }}</span>
      </div>
      <div v-if="!state.runs.length" class="rounded-xl border border-dashed border-card px-4 py-10 text-center">
        <div class="text-sm font-medium">{{ t('No run saved yet.') }}</div>
        <div class="mt-1 text-xs text-darker">{{ t('Start a run, then hit a training dummy. Finished runs are saved here to compare.') }}</div>
      </div>
      <div v-for="[group, runs] in groups" :key="group" class="mb-4 overflow-hidden rounded-xl border border-card">
        <div class="border-b border-card bg-card px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-darker">{{ t('Group {n}', { n: group }) }}</div>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-[color:var(--line)]">
            <template v-for="r in runs" :key="r.id">
            <tr :class="['group cursor-pointer', picked.includes(r.id) ? 'bg-accent-soft/40' : 'hover:bg-card']" @click="pick(r.id)">
              <td class="w-10 py-2 pl-4"><input type="checkbox" class="accent-[color:var(--accent)]" :checked="picked.includes(r.id)" @click.stop="pick(r.id)" /></td>
              <td class="py-2">
                <div class="font-medium">{{ r.name }}<span v-if="!r.finished" class="ml-1.5 rounded border border-light px-1 text-[10px] font-normal text-darker">{{ t('stopped') }}</span></div>
                <div class="text-xs text-darker">{{ goalText(r) }}</div>
              </td>
              <td class="w-24 px-3 text-right font-semibold tabular-nums">{{ short(r.dps) }}<span class="ml-0.5 text-[10px] font-normal text-darker">DPS</span></td>
              <td class="w-24 px-3 text-right tabular-nums text-darker">{{ short(r.damage) }}</td>
              <td class="w-16 px-3 text-right tabular-nums text-darker">{{ clock(r.durationMs) }}</td>
              <td class="w-16 px-3 text-right tabular-nums text-darker">{{ (r.critRate * 100).toFixed(0) }}%</td>
              <td class="w-32 px-3 text-xs text-darker">{{ when(r.at) }}</td>
              <td class="w-40 px-1 text-right">
                <button
                  type="button"
                  :class="['h-7 rounded-md px-2 text-xs hover:bg-light', expanded === r.id ? 'text-default' : 'text-darker']"
                  :title="t('Its skills: DPS, share, hits and crits')"
                  @click.stop="expanded = expanded === r.id ? null : r.id"
                >Skills {{ expanded === r.id ? '▴' : '▾' }}</button>
                <button
                  v-if="r.details"
                  type="button"
                  class="h-7 rounded-md px-2 text-xs text-accent hover:bg-light"
                  :title="t('The whole breakdown: skills, hits, defense, rotation and buffs')"
                  @click.stop="openDetails(r)"
                >{{ t('Details') }}</button>
              </td>
              <td class="w-12 pr-3 text-right">
                <button type="button" class="inline-flex size-7 items-center justify-center rounded-md text-darker opacity-0 hover:bg-light hover:text-danger group-hover:opacity-100" :title="t('Delete this run')" @click.stop="api.invoke('dummy:delete', r.id)">
                  <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" /></svg>
                </button>
              </td>
            </tr>
            <tr v-if="expanded === r.id" class="bg-default/40">
              <td colspan="9" class="px-4 py-2">
                <p v-if="!r.skills.length" class="text-xs text-darker">{{ t('No skills recorded for this run.') }}</p>
                <table v-else class="w-full text-xs">
                  <thead class="text-darker">
                    <tr>
                      <th class="py-1 text-left font-medium">Skill</th>
                      <th class="w-20 text-right font-medium">DPS</th>
                      <th class="w-20 text-right font-medium">{{ t('Damage') }}</th>
                      <th class="w-36 pl-3 text-left font-medium">{{ t('Share') }}</th>
                      <th class="w-14 text-right font-medium">Hits</th>
                      <th class="w-14 text-right font-medium">Crit</th>
                      <th class="w-20 text-right font-medium">{{ t('Avg hit') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in skillRows(r)" :key="s.key">
                      <td class="py-1"><span class="flex items-center gap-2"><SkillIcon :code="s.code" :size="18" />{{ s.name }}<span v-if="s.dot" class="text-darker">DoT</span></span></td>
                      <td class="text-right font-semibold tabular-nums">{{ short(s.dps) }}</td>
                      <td class="text-right tabular-nums text-darker">{{ short(s.damage) }}</td>
                      <td class="pl-3">
                        <span class="flex items-center gap-2">
                          <span class="h-1.5 w-20 overflow-hidden rounded-full bg-dark"><span class="block h-full bg-accent" :style="{ width: `${s.share}%` }" /></span>
                          <span class="tabular-nums text-darker">{{ s.share.toFixed(1) }}%</span>
                        </span>
                      </td>
                      <td class="text-right tabular-nums text-darker">{{ s.hits }}</td>
                      <td class="text-right tabular-nums text-darker">{{ s.critRate.toFixed(0) }}%</td>
                      <td class="text-right tabular-nums text-darker">{{ short(s.avg) }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
