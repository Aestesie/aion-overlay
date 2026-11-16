<script setup lang="ts">
// A player's Abyss rank, next to their combat power: an officer's stars, a general rank's name,
// or Soldier (shared/tracker.ts abyssRank).
import { computed } from 'vue'
import { t } from '@/lib/i18n.ts'
import { abyssRank } from '@shared/tracker.ts'

const props = defineProps<{ rank: number }>()
const r = computed(() => abyssRank(props.rank))
</script>

<template>
  <span
    v-if="r.kind === 'officer'"
    class="shrink-0 text-[11px] font-semibold tabular-nums text-orange"
    :title="t('Abyss rank: officer, {n} stars', { n: r.stars })"
  >{{ r.stars }}★</span>
  <span v-else-if="r.kind === 'general'" class="shrink-0 text-[11px] font-semibold text-orange" :title="t('Abyss rank')">{{ t(r.name) }}</span>
  <span v-else class="shrink-0 text-[11px] text-darker" :title="t('Abyss rank')">{{ t('Soldier') }}</span>
</template>
