<script setup lang="ts">
// Your debuffs on the enemy you fight: one box per watched debuff (settings.targetDebuffs.watch,
// by name), with the time left and a ring running down. One that is not on the target, or is
// about to run out, flashes red, and the strip on top says which are missing; with all of them up
// it is edged green. A chime plays when one drops off mid-fight. Shown while you fight (your last
// hit or effect within `idleMs`); while the dashboard is up, a preview to drag into place.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuffIcon from '@/components/BuffIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { playChime } from '@/lib/chime.ts'
import { t } from '@/lib/i18n.ts'
import { buffIdNamed, buffName, nameKey, remaining } from '@/lib/buffs.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import type { TargetDebuff } from '@shared/buffs.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.targetDebuffs)
const state = computed(() => store.targetDebuffs)
const now = ref(Date.now())

const fighting = computed(() => state.value.target !== null && now.value - state.value.lastActive < cfg.value.idleMs)
const preview = computed(() => !fighting.value && store.panelVisible)
const shown = computed(() => cfg.value.watch.length > 0 && (fighting.value || preview.value))

type Status = 'ok' | 'low' | 'missing'
interface Slot {
  name: string
  /** The id to draw: the one on the target, else the table's first for that name. */
  id: number
  debuff: TargetDebuff | null
  left: number | null
  share: number
  status: Status
}

const left = (d: TargetDebuff): number | null => (d.endsAt === null ? null : d.endsAt - now.value)

const slots = computed<Slot[]>(() =>
  cfg.value.watch.map((name, n) => {
    const key = nameKey(name)
    let debuff: TargetDebuff | null = null
    if (preview.value) {
      // A sample: the first up for a while, the second running out, the rest missing.
      const id = buffIdNamed(name) ?? 0
      const length = 15_000
      const endsAt = n === 0 ? now.value + 11_400 : n === 1 ? now.value + 2_100 : null
      debuff = endsAt === null ? null : { id, stacks: 1, endsAt, startedAt: endsAt - length, skill: null }
    } else {
      // The one that runs longest, of all the ids with this name (a skill's levels each have their own).
      for (const d of state.value.debuffs) {
        if (nameKey(buffName(d.id)) !== key) continue
        if (d.endsAt !== null && d.endsAt <= now.value) continue
        if (!debuff || (d.endsAt ?? Infinity) > (debuff.endsAt ?? Infinity)) debuff = d
      }
    }
    const l = debuff ? left(debuff) : null
    const share = debuff?.endsAt == null ? 1 : Math.max(0, Math.min(1, (debuff.endsAt - now.value) / Math.max(1, debuff.endsAt - debuff.startedAt)))
    const status: Status = !debuff ? 'missing' : l !== null && l < cfg.value.warnMs ? 'low' : 'ok'
    return { name, id: debuff?.id ?? buffIdNamed(name) ?? 0, debuff, left: l, share, status }
  }),
)
const missing = computed(() => slots.value.filter((s) => s.status === 'missing'))
const allUp = computed(() => slots.value.every((s) => s.status === 'ok'))
const title = computed(() => (preview.value ? t('Preview') : state.value.name || t('Target')))

// A chime when one drops off the target mid-fight (once per drop, not while it stays off).
let up = new Set<string>()
watch(
  () => slots.value.map((s) => `${s.name}:${s.status !== 'missing'}`).join('|'),
  () => {
    const nowUp = new Set(slots.value.filter((s) => s.status !== 'missing').map((s) => s.name))
    const dropped = fighting.value && !preview.value && [...up].some((n) => !nowUp.has(n))
    up = nowUp
    if (dropped && cfg.value.sound) playChime(cfg.value.volume)
  },
)
// Another target: what was up on the last one does not count as dropped.
watch(() => state.value.target, () => (up = new Set()))

const drag = windowDrag({ move: 'targetDebuffs:moveTo', end: 'targetDebuffs:dragEnd' })

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && shown.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('targetDebuffs:resize', { width: r.width, height: r.height })
}
watch([shown, () => cfg.value.watch.length, () => cfg.value.size, () => missing.value.length], () => void nextTick(report))

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
        v-if="shown"
        :class="[
          'm-1.5 cursor-move rounded-lg border-2 bg-darker/85 p-1.5 shadow-card',
          missing.length ? 'td-alarm border-danger' : allUp ? 'border-success' : 'border-card',
        ]"
        :style="{ opacity: cfg.opacity }"
        :title="t('Drag to move')"
        @pointerdown="drag.onPointerDown"
      >
        <div class="mb-1 flex max-w-[28rem] items-center gap-2 px-0.5 text-[11px] font-semibold leading-tight">
          <span class="truncate text-darker">{{ title }}</span>
          <span v-if="missing.length" class="ml-auto truncate text-danger">{{ t('Missing') }}: {{ missing.map((s) => s.name).join(', ') }}</span>
          <span v-else-if="allUp" class="ml-auto text-success">{{ t('All up') }}</span>
        </div>
        <div class="flex gap-1.5">
          <div v-for="s in slots" :key="s.name" class="flex flex-col items-center" :title="s.name" :style="{ width: `${cfg.size + 8}px` }">
            <div class="relative" :style="{ width: `${cfg.size}px`, height: `${cfg.size}px` }">
              <BuffIcon
                :id="s.id"
                :skill="s.debuff?.skill ?? null"
                :size="cfg.size"
                :class="['rounded', s.status === 'missing' ? 'opacity-35 grayscale' : '', s.status === 'ok' ? 'ring-1 ring-success' : 'ring-2 ring-danger']"
              />
              <div
                v-if="s.debuff && s.debuff.endsAt !== null"
                class="absolute inset-0 rounded"
                :style="{ background: `conic-gradient(transparent ${s.share * 360}deg, rgba(0,0,0,0.55) 0)` }"
              />
              <span v-if="s.status === 'missing'" class="td-blink absolute inset-0 flex items-center justify-center text-xl font-black text-danger">!</span>
              <span
                v-if="s.debuff && s.debuff.stacks > 1"
                class="absolute -bottom-0.5 -right-0.5 rounded bg-black/80 px-0.5 text-[10px] font-bold leading-tight tabular-nums text-white"
              >{{ s.debuff.stacks }}</span>
            </div>
            <span :class="['h-4 text-xs font-bold leading-tight tabular-nums', s.status === 'ok' ? 'text-default' : 'td-blink text-danger']">
              {{ s.status === 'missing' ? t('none') : remaining(s.left) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.td-blink {
  animation: td-blink 0.8s steps(2, start) infinite;
}
.td-alarm {
  animation: td-alarm 1s ease-in-out infinite;
}
@keyframes td-blink {
  to {
    visibility: hidden;
  }
}
@keyframes td-alarm {
  50% {
    box-shadow: 0 0 14px 2px rgb(239 68 68 / 0.75);
  }
}
</style>
