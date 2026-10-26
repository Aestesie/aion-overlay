<script setup lang="ts">
// What's new: each version's changes, one line each (shared/changelog.ts), newest first. In the
// sidebar's App group, under Updates. A version past the one running is the next
// update, still to come.
import { computed } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { CHANGELOG } from '@shared/changelog.ts'

const props = defineProps<{ version: string | null }>()

const parts = (v: string): number[] => v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
function newer(a: string, b: string): boolean {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}
const entries = computed(() =>
  CHANGELOG.map((e) => ({ ...e, upcoming: !!props.version && newer(e.version, props.version), current: e.version === props.version })),
)
</script>

<template>
  <div>
    <PageHeader title="What's new" about="The changes in each version, newest first." />
    <div class="space-y-4">
      <section v-for="e in entries" :key="e.version" class="rounded-xl border border-card bg-card px-4 py-3">
        <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold">
          v{{ e.version }}
          <span v-if="e.current" class="rounded bg-accent/20 px-1.5 text-[10px] font-bold uppercase text-accent">This version</span>
          <span v-else-if="e.upcoming" class="rounded bg-green/20 px-1.5 text-[10px] font-bold uppercase text-green">Next update</span>
        </h3>
        <ul class="space-y-1 text-sm text-dark">
          <li v-for="item in e.items" :key="item" class="flex gap-2">
            <span class="mt-[7px] size-1 shrink-0 rounded-full bg-darker" />
            <span>{{ item }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
