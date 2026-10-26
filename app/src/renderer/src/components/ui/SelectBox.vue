<script setup lang="ts" generic="T extends string | number">
// A native select dressed as shadcn's: the input's border, a chevron, the app's background. Its
// options' labels are shown translated (lib/i18n.ts).
import { t } from '@/lib/i18n.ts'
defineProps<{ modelValue: T; options: readonly { id: T; label: string }[]; size?: 'sm' | 'md' }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
function pick(e: Event, options: readonly { id: T; label: string }[]): void {
  const i = (e.target as HTMLSelectElement).selectedIndex
  const o = options[i]
  if (o) emit('update:modelValue', o.id)
}
</script>

<template>
  <div class="relative inline-flex">
    <select
      :class="[
        'appearance-none rounded-md border border-light bg-default pr-7 text-default focus:border-accent',
        size === 'sm' ? 'h-7 pl-2 text-xs' : 'h-8 pl-2.5 text-sm',
      ]"
      @change="pick($event, options)"
    >
      <option v-for="o in options" :key="String(o.id)" :value="String(o.id)" :selected="o.id === modelValue">{{ t(o.label) }}</option>
    </select>
    <svg viewBox="0 0 16 16" class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-darker" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="m4 6 4 4 4-4" />
    </svg>
  </div>
</template>
