<script setup lang="ts">
// A buff's icon (lib/buffs.ts): its image, else its skill's, else a plain dot.
import { computed, ref, watch } from 'vue'
import { buffIcon } from '@/lib/buffs.ts'

const props = defineProps<{ id: number; skill?: number | null; size?: number }>()
const icon = computed(() => buffIcon(props.id, props.skill))
const broken = ref(false)
watch(() => props.id, () => (broken.value = false))
const px = computed(() => `${props.size ?? 20}px`)
</script>

<template>
  <img v-if="icon && !broken" :src="icon" alt="" draggable="false" class="shrink-0 rounded-sm object-cover" :style="{ width: px, height: px }" @error="broken = true" />
  <span v-else class="flex shrink-0 items-center justify-center rounded-sm bg-dark text-darker" :style="{ width: px, height: px }">
    <svg viewBox="0 0 24 24" class="size-1/2" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
  </span>
</template>
