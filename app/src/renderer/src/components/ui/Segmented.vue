<script setup lang="ts" generic="T extends string | number | null">
// shadcn's tabs as a segmented control: the options in a muted track, the chosen one raised. Its
// labels are shown translated (lib/i18n.ts).
import { t } from '@/lib/i18n.ts'
defineProps<{ modelValue: T; options: readonly { id: T; label: string; count?: number }[]; size?: 'sm' | 'md' }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div :class="['inline-flex items-center gap-0.5 rounded-lg bg-dark p-0.5', size === 'sm' ? 'text-xs' : 'text-sm']">
    <button
      v-for="o in options"
      :key="String(o.id)"
      type="button"
      :class="[
        'rounded-md font-medium transition-colors',
        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1',
        modelValue === o.id ? 'bg-light text-default shadow-sm' : 'text-darker hover:text-default',
      ]"
      @click="emit('update:modelValue', o.id)"
    >
      {{ t(o.label) }}<span v-if="o.count !== undefined" class="ml-1 tabular-nums opacity-60">{{ o.count }}</span>
    </button>
  </div>
</template>
