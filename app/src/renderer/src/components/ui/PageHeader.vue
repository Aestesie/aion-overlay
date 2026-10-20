<script setup lang="ts">
// A dashboard page's title and what it is, with its actions on the right.
defineProps<{ title: string; about?: string }>()
</script>

<template>
  <div class="mb-6 flex items-start gap-4">
    <div class="min-w-0 flex-1">
      <h1 class="text-2xl font-bold tracking-tight">{{ title }}</h1>
      <p v-if="about" class="mt-1 max-w-3xl text-sm text-darker">{{ about }}</p>
    </div>
    <div v-if="$slots.default" class="flex shrink-0 items-center gap-2"><slot /></div>
  </div>
</template>
