<script setup lang="ts">
// How long until `at` (ms), as questlog shows it: "1h 51m 08s", the units small. Days drop the
// seconds. "now" once it is past.
import { computed } from 'vue'

const props = defineProps<{ at: number; now: number }>()
const parts = computed<[string, string][]>(() => {
  const s = Math.floor((props.at - props.now) / 1000)
  if (s <= 0) return []
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (d) return [[String(d), 'd'], [String(h), 'h'], [pad(m), 'm']]
  if (h) return [[String(h), 'h'], [pad(m), 'm'], [pad(sec), 's']]
  return [[String(m), 'm'], [pad(sec), 's']]
})
</script>

<template>
  <span class="whitespace-nowrap tabular-nums">
    <template v-if="parts.length">
      <template v-for="([n, u], i) in parts" :key="i"><span v-if="i" class="inline-block w-1" />{{ n }}<span class="text-[0.7em] text-darker">{{ u }}</span></template>
    </template>
    <span v-else class="text-green">now</span>
  </span>
</template>
