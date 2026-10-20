<script setup lang="ts">
// A switch, shadcn's: a track in the accent when on, the input's grey when off, and a white knob
// either way. Keyboard-operable.
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :class="[
      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
      modelValue ? 'bg-accent' : 'bg-lighter',
    ]"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      :class="[
        'inline-block size-4 rounded-full bg-white shadow-sm transition-transform',
        modelValue ? 'translate-x-4' : 'translate-x-0',
      ]"
    />
  </button>
</template>
