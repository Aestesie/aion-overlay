<script setup lang="ts">
// An alert's sound (a Hidden Cube, an enemy): which one, Test, your own mp3 (copied into the data
// folder by main/sounds.ts), and how loud, as two setting rows. The cube's settings are in `hud`,
// the enemy's in `enemies`.
import { computed, ref } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { playSound } from '@/lib/sound.ts'
import { useApp } from '@/stores/app.ts'
import { SOUNDS, type SoundId, type SoundSlot } from '@shared/sounds.ts'

const props = defineProps<{ kind: SoundSlot; label: string }>()
const store = useApp()

const id = computed<SoundId>(() => (props.kind === 'cube' ? store.settings.hud.cubeSoundId : store.settings.enemies.soundId))
const volume = computed(() => (props.kind === 'cube' ? store.settings.hud.cubeVolume : store.settings.enemies.volume))
const customName = computed(() => (props.kind === 'cube' ? store.settings.hud.cubeCustomName : store.settings.enemies.customName))
const options = computed(() => SOUNDS.map((s) => ({ id: s.id, label: s.id === 'custom' && customName.value ? t('Your own: {name}', { name: customName.value }) : s.label })))
const note = ref<string | null>(null)

function save(patch: { id?: SoundId; volume?: number }): void {
  if (props.kind === 'cube') {
    void store.setHud({ ...(patch.id ? { cubeSoundId: patch.id } : {}), ...(patch.volume !== undefined ? { cubeVolume: patch.volume } : {}) })
  } else {
    void store.set('enemies', { ...store.settings.enemies, ...(patch.id ? { soundId: patch.id } : {}), ...(patch.volume !== undefined ? { volume: patch.volume } : {}) })
  }
}
async function test(): Promise<void> {
  note.value = (await playSound(props.kind, id.value, volume.value)) ? null : t('It could not be played: choose your mp3 again.')
}
async function pick(): Promise<void> {
  const result = await bridge().invoke('sounds:pickCustom', props.kind)
  if (!result) return
  note.value = result.ok ? null : `Not taken: ${result.error}.`
  // Main saved it as the sound: play it once, as Test would.
  if (result.ok) await playSound(props.kind, 'custom', volume.value)
}
function choose(next: SoundId): void {
  note.value = null
  // Your own, with none chosen yet: ask for the file (the choice is saved with it).
  if (next === 'custom' && !customName.value) void pick()
  else save({ id: next })
}
const pct = (v: number): string => `${Math.round(v * 100)}%`
</script>

<template>
  <SettingRow :label="label" :hint="note ?? 'Or your own mp3 (up to 2 MB): a copy is kept in the app\'s data folder.'">
    <div class="flex items-center gap-2">
      <SelectBox size="sm" :model-value="id" :options="options" @update:model-value="choose" />
      <Button size="sm" @click="test">{{ t('Test') }}</Button>
      <Button size="sm" @click="pick">{{ customName ? t('Change mp3…') : t('Add mp3…') }}</Button>
    </div>
  </SettingRow>
  <SettingRow :label="t('{name} volume', { name: t(label) })">
    <Slider :model-value="volume" :min="0" :max="1" :step="0.05" :format="pct" @update:model-value="save({ volume: $event })" />
  </SettingRow>
</template>
