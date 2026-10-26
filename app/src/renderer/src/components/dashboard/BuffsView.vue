<script setup lang="ts">
// Buffs: what is on your character now, as the buffs overlay shows it, in a list with names; and
// the overlay's settings. From A2Tools DPS Meter's buff timeline (the game's buff records). A
// fight's buffs, each player's and the target's, are in the Details window's Buffs tab.
import { computed, onBeforeUnmount, ref } from 'vue'
import BuffIcon from '@/components/BuffIcon.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import { buffName, hiddenBuff, remaining } from '@/lib/buffs.ts'
import { plural, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import type { Buff } from '@shared/buffs.ts'

const store = useApp()
const cfg = computed(() => store.settings.buffs)
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => clearInterval(ticker))

const current = computed(() => store.buffs.filter((b) => b.endsAt === null || b.endsAt > now.value - 500))
/** What the game shows you; the rest (internal effects) only counted, unless asked for. */
const showHidden = ref(false)
const hiddenCount = computed(() => current.value.filter((b) => hiddenBuff(b.id, b.skill, b.endsAt !== null, (b.endsAt ?? 0) - b.startedAt)).length)
const live = computed(() => current.value.filter((b) => showHidden.value || !hiddenBuff(b.id, b.skill, b.endsAt !== null, (b.endsAt ?? 0) - b.startedAt)))
const order = (a: Buff, b: Buff): number => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) || buffName(a.id).localeCompare(buffName(b.id))
const groups = computed(() => [
  { title: 'Debuffs', rows: live.value.filter((b) => b.debuff).sort(order) },
  { title: 'Buffs', rows: live.value.filter((b) => !b.debuff && !b.passive).sort(order) },
  { title: 'Passives and toggles', rows: live.value.filter((b) => !b.debuff && b.passive).sort(order) },
])
const from = (b: Buff): string => (b.mine ? t('You') : b.debuff ? t('A monster') : b.by ? t('Another player') : '—')
const share = (b: Buff): number => (b.endsAt === null ? 1 : Math.max(0, Math.min(1, (b.endsAt - now.value) / Math.max(1, b.endsAt - b.startedAt))))
const set = (patch: Partial<typeof cfg.value>): void => void store.set('buffs', { ...cfg.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
</script>

<template>
  <div>
    <PageHeader title="Buffs" about="The buffs and debuffs on your character, read from the game's traffic, with what is left of each. A fight's buffs, every player's and the target's, are in its Details window." />

    <Section title="On you now" icon="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" bare>
      <div v-if="!cfg.enabled && !cfg.cc" class="rounded-xl border border-dashed border-card px-4 py-8 text-center text-sm text-darker">
        {{ t('Turn on the buffs overlay or the CC panel below: your buffs are only read while one is on.') }}
      </div>
      <div v-else-if="!live.length" class="rounded-xl border border-dashed border-card px-4 py-8 text-center text-sm text-darker">
        {{ t('Nothing on you yet. Buffs show up as the game applies them (after a zone change, everything on you is listed).') }}
      </div>
      <div v-else class="overflow-hidden rounded-xl border border-card">
        <table class="w-full text-sm">
          <thead class="bg-card text-xs uppercase tracking-wide text-darker">
            <tr class="border-b border-card">
              <th class="py-2.5 pl-4 text-left font-medium">Buff</th>
              <th class="w-20 px-3 text-right font-medium">Stacks</th>
              <th class="w-36 px-3 text-left font-medium">{{ t('From') }}</th>
              <th class="w-48 pr-4 text-left font-medium">{{ t('Time left') }}</th>
            </tr>
          </thead>
          <template v-for="g in groups" :key="g.title">
            <tbody v-if="g.rows.length" class="divide-y divide-[color:var(--line)]">
              <tr class="bg-dark/50"><td colspan="4" class="py-1 pl-4 text-[11px] font-semibold uppercase tracking-wider text-darkest">{{ t(g.title) }}</td></tr>
              <tr v-for="b in g.rows" :key="`${b.id}-${b.by}`" class="hover:bg-card">
                <td class="py-1.5 pl-4">
                  <div class="flex items-center gap-2.5">
                    <BuffIcon :id="b.id" :skill="b.skill" :size="24" :class="b.debuff && 'ring-1 ring-danger'" />
                    <span :class="['truncate', b.debuff && 'text-danger']">{{ buffName(b.id) }}</span>
                  </div>
                </td>
                <td class="px-3 text-right tabular-nums text-darker">{{ b.stacks > 1 ? b.stacks : '' }}</td>
                <td class="px-3 text-xs text-darker">{{ from(b) }}</td>
                <td class="pr-4">
                  <div v-if="b.endsAt !== null" class="flex items-center gap-2">
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-dark">
                      <div :class="['h-full', b.debuff ? 'bg-danger' : 'bg-accent']" :style="{ width: `${share(b) * 100}%` }" />
                    </div>
                    <span class="w-12 text-right text-xs tabular-nums">{{ remaining(b.endsAt - now) }}</span>
                  </div>
                  <span v-else class="text-xs text-darkest">{{ t('no timer') }}</span>
                </td>
              </tr>
            </tbody>
          </template>
        </table>
        <button v-if="hiddenCount" type="button" class="w-full border-t border-card px-4 py-2 text-left text-xs text-darker hover:bg-card" @click="showHidden = !showHidden">
          {{
            showHidden
              ? plural(hiddenCount, 'Hide {n} hidden effect (internal ones with no name or icon, system regen, account rewards)', 'Hide {n} hidden effects (internal ones with no name or icon, system regen, account rewards)')
              : plural(hiddenCount, 'Show {n} hidden effect (internal ones with no name or icon, system regen, account rewards)', 'Show {n} hidden effects (internal ones with no name or icon, system regen, account rewards)')
          }}
        </button>
      </div>
    </Section>

    <Section title="CC / Debuffs" icon="M8 1.5v3M3.5 3.5l2 2M12.5 3.5l-2 2M5 9.5a3 3 0 1 0 6 0 3 3 0 0 0-6 0z">
      <SettingRow label="Show when I lose control" hint="A banner mid-screen while you are stunned, knocked down, rooted, feared, silenced... with the seconds left. Clicks pass through it; while this window is open it shows a preview you can drag into place.">
        <Toggle :model-value="cfg.cc" @update:model-value="set({ cc: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.cc" label="Monsters' other debuffs" hint="Under the banner: the other debuffs monsters put on you (poisons, slows...), with their time left.">
        <Toggle :model-value="cfg.ccDebuffs" @update:model-value="set({ ccDebuffs: $event })" />
      </SettingRow>
    </Section>

    <Section title="Buffs overlay" icon="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z">
      <SettingRow label="Show my buffs over the game" hint="Each buff's icon with its stacks and time left; drag it to move it. It hides while nothing is on you.">
        <Toggle :model-value="cfg.enabled" @update:model-value="set({ enabled: $event })" />
      </SettingRow>
      <template v-if="cfg.enabled">
        <SettingRow label="Debuffs on their own row" hint="What monsters put on you, on a row above your buffs, edged in red.">
          <Toggle :model-value="cfg.debuffs" @update:model-value="set({ debuffs: $event })" />
        </SettingRow>
        <SettingRow label="Passives and toggles" hint="Your class passives and toggles, without a timer: always on, so hidden unless you want them.">
          <Toggle :model-value="cfg.passives" @update:model-value="set({ passives: $event })" />
        </SettingRow>
        <SettingRow label="Scrolls, food and drinks" hint="The long buffs from items you used. Off, they stay out of the overlay (they are still listed above).">
          <Toggle :model-value="cfg.consumables" @update:model-value="set({ consumables: $event })" />
        </SettingRow>
        <SettingRow label="Icon size">
          <Slider :model-value="cfg.size" :min="22" :max="56" :step="2" :format="(v: number) => `${v}px`" @update:model-value="set({ size: $event })" />
        </SettingRow>
        <SettingRow label="Icons per row">
          <Slider :model-value="cfg.perRow" :min="4" :max="20" :step="1" @update:model-value="set({ perRow: $event })" />
        </SettingRow>
        <SettingRow label="Opacity">
          <Slider :model-value="cfg.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="set({ opacity: $event })" />
        </SettingRow>
      </template>
    </Section>
  </div>
</template>
