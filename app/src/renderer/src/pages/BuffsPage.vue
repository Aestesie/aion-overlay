<script setup lang="ts">
// Your buffs and debuffs over the game: each one's icon with its stacks, and the time left under
// it (a ring runs down around timed ones). Buffs on one row, debuffs (cast by monsters) on another,
// red-edged. Moved by dragging; sized to what it shows, hidden while nothing is on you.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuffIcon from '@/components/BuffIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { buffName, remaining } from '@/lib/buffs.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import type { Buff } from '@shared/buffs.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.buffs)
const now = ref(Date.now())

/** Timed ones first, the soonest to run out first; then the ones without a timer. */
const order = (a: Buff, b: Buff): number => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) || a.id - b.id
const live = computed(() => store.buffs.filter((b) => (cfg.value.passives || !b.passive) && (b.endsAt === null || b.endsAt > now.value - 500)))
const buffs = computed(() => live.value.filter((b) => !b.debuff || !cfg.value.debuffs).sort(order))
const debuffs = computed(() => (cfg.value.debuffs ? live.value.filter((b) => b.debuff).sort(order) : []))
const rows = computed(() => [debuffs.value, buffs.value].filter((r) => r.length))

const left = (b: Buff): number | null => (b.endsAt === null ? null : b.endsAt - now.value)
/** How much of its time is left, 0..1, for the ring. */
const share = (b: Buff): number => (b.endsAt === null ? 1 : Math.max(0, Math.min(1, (b.endsAt - now.value) / Math.max(1, b.endsAt - b.startedAt))))
const tip = (b: Buff): string => [buffName(b.id), b.stacks > 1 ? `${b.stacks} stacks` : '', b.debuff ? 'debuff' : b.mine ? 'yours' : ''].filter(Boolean).join(' · ')

const drag = windowDrag({ move: 'buffs:moveTo', end: 'buffs:dragEnd' })

/** Tell main how big the window is; nothing on you measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && rows.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('buffs:resize', { width: r.width, height: r.height })
}
watch(() => rows.value.map((r) => r.length).join(), () => void nextTick(report))

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
      <div
        v-if="rows.length"
        class="m-1.5 cursor-move space-y-1 rounded-lg border border-card bg-darker/80 p-1.5 shadow-card"
        :style="{ opacity: cfg.opacity }"
        title="Drag to move"
        @pointerdown="drag.onPointerDown"
      >
        <div
          v-for="(row, n) in rows"
          :key="n"
          class="grid gap-1"
          :style="{ gridTemplateColumns: `repeat(${Math.min(cfg.perRow, row.length)}, ${cfg.size}px)` }"
        >
          <div v-for="b in row.slice(0, cfg.perRow * 2)" :key="`${b.id}-${b.by}`" class="flex flex-col items-center" :title="tip(b)">
            <div class="relative" :style="{ width: `${cfg.size}px`, height: `${cfg.size}px` }">
              <BuffIcon :id="b.id" :skill="b.skill" :size="cfg.size" :class="['rounded', b.debuff ? 'ring-1 ring-danger' : '']" />
              <!-- Time left: a dark wedge grows as it runs out. -->
              <div
                v-if="b.endsAt !== null"
                class="absolute inset-0 rounded"
                :style="{ background: `conic-gradient(transparent ${share(b) * 360}deg, rgba(0,0,0,0.55) 0)` }"
              />
              <span
                v-if="b.stacks > 1"
                class="absolute -bottom-0.5 -right-0.5 rounded bg-black/80 px-0.5 text-[10px] font-bold leading-tight tabular-nums text-white"
              >{{ b.stacks }}</span>
            </div>
            <span :class="['h-3.5 text-[10px] font-semibold leading-tight tabular-nums', (left(b) ?? Infinity) < 5000 ? 'text-danger' : 'text-default']">{{ remaining(left(b)) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
