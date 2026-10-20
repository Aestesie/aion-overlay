<script setup lang="ts">
// A skill's icon (lib/skillIcons.ts): its image, crossed swords for a basic attack, a plain mark
// when none is known or the image is missing.
import { computed, ref, watch } from 'vue'
import { skillIcon } from '@/lib/skillIcons.ts'

const props = defineProps<{ code: number; size?: number }>()
const icon = computed(() => skillIcon(props.code))
const broken = ref(false)
watch(() => props.code, () => (broken.value = false))
const px = computed(() => `${props.size ?? 20}px`)
</script>

<template>
  <img
    v-if="icon && icon !== 'basic' && !broken"
    :src="icon"
    alt=""
    draggable="false"
    class="shrink-0 rounded-sm object-cover"
    :style="{ width: px, height: px }"
    @error="broken = true"
  />
  <span v-else class="flex shrink-0 items-center justify-center rounded-sm bg-dark text-darker" :style="{ width: px, height: px }">
    <svg v-if="icon === 'basic'" viewBox="0 0 24 24" class="size-3/4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
    </svg>
    <svg v-else viewBox="0 0 24 24" class="size-1/2" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
  </span>
</template>
