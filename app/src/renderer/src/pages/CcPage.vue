<script setup lang="ts">
// The CC / Debuffs banner (questlog.gg's "Loss of control"): while you are stunned, rooted, knocked
// down, feared... a banner mid-screen with the effect's icon, what it is and the seconds left, a bar
// running down under it. Optionally the monsters' other debuffs on you in a row below. CC is told
// by the game's own type for each effect (lib/buffs.ts, ccKind). Clicks go through to the game; while
// the dashboard is up it shows a preview, and can be dragged into place.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuffIcon from '@/components/BuffIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { buffName, CC_LABEL, ccKind, remaining, type CcKind } from '@/lib/buffs.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import type { Buff } from '@shared/buffs.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.buffs)
const now = ref(Date.now())

/** An effect on you that takes control away: never one you cast; a transformation only from a monster. */
function cc(b: Buff): CcKind | null {
  if (b.mine || b.endsAt === null) return null
  const kind = ccKind(b.id)
  return kind === 'polymorph' && !b.debuff ? null : kind
}
const live = computed(() => store.buffs.filter((b) => b.endsAt !== null && b.endsAt > now.value))
/** The control lost now, the latest first: the banner shows it, the rest beside it. */
const controls = computed(() =>
  live.value
    .map((b) => ({ b, kind: cc(b) }))
    .filter((c): c is { b: Buff; kind: CcKind } => c.kind !== null)
    .sort((x, y) => y.b.startedAt - x.b.startedAt || (y.b.endsAt ?? 0) - (x.b.endsAt ?? 0)),
)
const debuffs = computed(() => (cfg.value.ccDebuffs ? live.value.filter((b) => b.debuff && !cc(b)).sort((x, y) => (x.endsAt ?? 0) - (y.endsAt ?? 0)) : []))
/** Nothing on you while the dashboard is up: a sample to place it by. */
const preview = computed(() => !controls.value.length && store.panelVisible)
const main = computed(() => controls.value[0] ?? null)
const left = (b: Buff): number => Math.max(0, (b.endsAt ?? 0) - now.value)
const share = (b: Buff): number => Math.max(0, Math.min(1, left(b) / Math.max(1, (b.endsAt ?? 0) - b.startedAt)))
const seconds = (b: Buff): string => `${(left(b) / 1000).toFixed(1)} seconds`
const shown = computed(() => !!main.value || preview.value || debuffs.value.length > 0)

const drag = windowDrag({ move: 'cc:moveTo', end: 'cc:dragEnd' })

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && shown.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('cc:resize', { width: r.width, height: r.height })
}
watch([shown, () => debuffs.value.length, () => controls.value.length], () => void nextTick(report))

let timer: ReturnType<typeof setInterval> | null = null
let observer: ResizeObserver | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 100)
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div v-if="shown" :class="['m-1.5 w-[380px]', preview && 'cursor-move']" @pointerdown="preview && drag.onPointerDown($event)">
        <div v-if="main || preview" class="relative bg-gradient-to-r from-transparent via-black/80 to-transparent px-6 py-3">
          <div class="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-danger to-transparent" />
          <div class="flex items-center justify-center gap-3.5">
            <BuffIcon v-if="main" :id="main.b.id" :skill="main.b.skill" :size="52" class="rounded-lg ring-1 ring-danger/70" />
            <div v-else class="flex size-[52px] items-center justify-center rounded-lg bg-danger/30 ring-1 ring-danger/70">
              <svg viewBox="0 0 16 16" class="size-7 text-yellow" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 1.5v3M3.5 3.5l2 2M12.5 3.5l-2 2M5 9.5a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM5.5 14h5" /></svg>
            </div>
            <div class="min-w-0">
              <div class="truncate text-[26px] font-bold leading-tight text-[#f5d77a] drop-shadow" :title="main ? buffName(main.b.id) : ''">
                {{ main ? CC_LABEL[main.kind] : 'Stunned' }}
              </div>
              <div class="text-lg leading-tight tabular-nums text-default drop-shadow">{{ main ? seconds(main.b) : '2.0 seconds' }}</div>
            </div>
          </div>
          <div class="mx-auto mt-2.5 h-1 w-3/5 overflow-hidden rounded-full bg-white/10">
            <div class="h-full bg-danger" :style="{ width: `${(main ? share(main.b) : 0.6) * 100}%` }" />
          </div>
          <div v-if="controls.length > 1" class="mt-1.5 flex justify-center gap-2 text-[11px] text-dark">
            <span v-for="c in controls.slice(1, 4)" :key="`${c.b.id}-${c.b.by}`">+ {{ CC_LABEL[c.kind] }} {{ remaining(left(c.b)) }}s</span>
          </div>
          <div v-if="preview" class="mt-1 text-center text-[11px] text-darker">Preview while the dashboard is open: drag to move</div>
          <div class="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-danger to-transparent" />
        </div>
        <div v-if="debuffs.length" class="mt-1.5 flex justify-center gap-1.5">
          <div v-for="b in debuffs.slice(0, 8)" :key="`${b.id}-${b.by}`" class="flex flex-col items-center" :title="buffName(b.id)">
            <BuffIcon :id="b.id" :skill="b.skill" :size="28" class="rounded ring-1 ring-danger/70" />
            <span class="text-[10px] font-semibold tabular-nums text-default drop-shadow">{{ remaining(left(b)) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
