<script setup lang="ts">
// The packet log's pill over the game (Alt+Shift+R): while it records, how long and how many marks;
// once it stops, the file it went to, for the few seconds main keeps the window (packets.ts).
// Clicks go through to the game.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { NO_PACKET_LOG, type PacketLog } from '@shared/meter.ts'

const api = bridge()
const root = ref<HTMLElement | null>(null)
const log = ref<PacketLog>({ ...NO_PACKET_LOG })
const now = ref(Date.now())

const elapsed = computed(() => {
  const s = log.value.startedAt ? Math.max(0, Math.floor((now.value - log.value.startedAt) / 1000)) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path
const shown = computed(() => log.value.on || !!log.value.path)

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && shown.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('packets:resize', { width: r.width, height: r.height })
}
watch([shown, () => log.value.on], () => void nextTick(report))

let off: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let observer: ResizeObserver | null = null
onMounted(async () => {
  off = api.on('packets:state', (s) => (log.value = s))
  log.value = await api.invoke('packets:get')
  timer = setInterval(() => (now.value = Date.now()), 500)
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  off?.()
  if (timer) clearInterval(timer)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div v-if="shown" class="m-1.5 flex items-center gap-2 rounded-full border border-light bg-black/80 px-3 py-1.5 text-xs">
        <template v-if="log.on">
          <span class="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
          <span class="font-semibold text-default">Recording packets</span>
          <span class="tabular-nums text-dark">{{ elapsed }}</span>
          <span v-if="log.marks" class="text-dark">· {{ log.marks }} mark{{ log.marks === 1 ? '' : 's' }}</span>
          <span class="text-darker">· Alt+Shift+M mark · Alt+Shift+R stop</span>
        </template>
        <template v-else-if="log.path">
          <span class="size-2 shrink-0 rounded-full bg-green" />
          <span class="font-semibold text-default">Packet log saved</span>
          <span class="max-w-[260px] truncate text-dark">{{ fileName(log.path) }}</span>
          <span class="tabular-nums text-darker">· {{ log.count.toLocaleString('en-US') }} messages</span>
        </template>
      </div>
    </div>
  </div>
</template>
