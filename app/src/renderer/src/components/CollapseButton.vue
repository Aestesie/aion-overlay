<script setup lang="ts">
// An overlay's minimize button, in its header: a dash shrinks it to that line, a square brings it
// back. Stops the pointer so pressing it doesn't start dragging the window.
import { t } from '@/lib/i18n.ts'
defineProps<{ collapsed: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex size-5 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
    :title="collapsed ? t('Restore') : t('Minimize')"
    @pointerdown.stop
    @dblclick.stop
    @click="$emit('toggle')"
  >
    <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <rect v-if="collapsed" x="3.5" y="3.5" width="9" height="9" rx="1" />
      <path v-else d="M3.5 8h9" />
    </svg>
  </button>
</template>
