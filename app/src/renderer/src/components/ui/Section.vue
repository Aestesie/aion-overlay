<script setup lang="ts">
// A titled group of a page: a small uppercase heading (with an icon, a 16x16 stroked path), then
// its content in a card; `bare` leaves the card out. The title is shown translated (lib/i18n.ts).
import { t } from '@/lib/i18n.ts'
defineProps<{ title?: string; icon?: string; bare?: boolean }>()
</script>

<template>
  <section class="mb-6">
    <div v-if="title || $slots.actions" class="mb-2 flex items-center gap-2">
      <svg v-if="icon" viewBox="0 0 16 16" class="size-3.5 shrink-0 text-darker" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path :d="icon" />
      </svg>
      <h2 v-if="title" class="text-xs font-semibold uppercase tracking-wider text-darker">{{ t(title) }}</h2>
      <div class="ml-auto flex items-center gap-2"><slot name="actions" /></div>
    </div>
    <slot v-if="bare" />
    <div v-else class="divide-y divide-[color:var(--line)] overflow-hidden rounded-xl border border-card bg-card px-4">
      <slot />
    </div>
  </section>
</template>
