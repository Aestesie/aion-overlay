<script setup lang="ts">
// A Hidden Cube: a small golden cube, three faces in three shades.
defineProps<{ size?: number }>()
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size ?? 20" :height="size ?? 20" class="shrink-0" aria-hidden="true">
    <polygon points="12,2 21,7 12,12 3,7" fill="#fde68a" />
    <polygon points="3,7 12,12 12,22 3,17" fill="#f59e0b" />
    <polygon points="21,7 12,12 12,22 21,17" fill="#b45309" />
    <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="#78350f" stroke-width="1" stroke-linejoin="round" />
  </svg>
</template>
