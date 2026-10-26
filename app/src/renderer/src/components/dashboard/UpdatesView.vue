<script setup lang="ts">
// Updates: this copy's version and Check for updates, which downloads a newer release, puts it in
// and restarts the app (main/updater.ts), the installed and the portable copy alike. What's new
// lists what each version changed.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { CHANGELOG } from '@shared/changelog.ts'
import { releaseFile, releasePage, type UpdateState } from '@shared/update.ts'

const emit = defineEmits<{ go: [page: string] }>()

const info = ref<{ version: string } | null>(null)
const update = ref<UpdateState | null>(null)
let offUpdate: (() => void) | null = null
onMounted(async () => {
  offUpdate = bridge().on('update:state', (s) => (update.value = s))
  update.value = await bridge().invoke('update:get')
  // The newest release, for the manual download links (nothing is downloaded).
  void bridge().invoke('update:peek')
  info.value = await bridge().invoke('app:info')
})
onBeforeUnmount(() => offUpdate?.())

const updateLine = computed(() => {
  const u = update.value
  if (!u) return ''
  switch (u.status) {
    case 'dev':
      return t('Running from source: updates are for the installed app.')
    case 'idle':
      return t('Not checked yet. Check for updates downloads a newer version, puts it in and restarts the app (your settings and data stay).')
    case 'checking':
      return t('Checking GitHub for a newer version…')
    case 'current':
      return t('You have the latest version ({v}).', { v: u.latest ?? u.current })
    case 'available':
      return u.releasedAt
        ? t('Version {v} is out ({date}).', { v: u.latest ?? '', date: new Date(u.releasedAt).toLocaleDateString(loc()) })
        : t('Version {v} is out.', { v: u.latest ?? '' })
    case 'downloading':
      return t("Downloading version {v}… {p}%. The app restarts by itself once it's in.", { v: u.latest ?? '', p: u.percent })
    case 'ready':
      return t('Version {v} is downloaded: restarting to put it in…', { v: u.latest ?? '' })
    case 'error':
      return t('Could not update: {error}', { error: u.error ?? t('unknown error') })
  }
  return ''
})

/**
 * Manual download: the newest release's files, once a check has found its version (their names
 * carry it); before that, the releases page. The one matching this copy (installer or zip) first.
 */
const manual = computed(() => {
  const u = update.value
  const version = u?.latest ?? null
  const files = version
    ? [
        { kind: 'installer' as const, label: t('Installer ({file})', { file: `Lokthar-Setup-${version}.exe` }), about: 'Installs over this copy, like the automatic update.' },
        { kind: 'portable' as const, label: t('Portable zip ({file})', { file: `Lokthar-${version}-portable.zip` }), about: 'Unpack it over this folder, or anywhere, and run Aion2DropTracker.exe.' },
      ].map((f) => ({ ...f, url: releaseFile(version, f.kind) }))
    : []
  if (u?.portable) files.reverse()
  return { version, files, page: releasePage(version) }
})

/** This version's lines from the changelog, if it has them. */
const thisVersion = computed(() => CHANGELOG.find((e) => e.version === (update.value?.current ?? info.value?.version)) ?? null)
</script>

<template>
  <div>
    <PageHeader title="Updates" about="Check for updates downloads a newer version from GitHub, puts it in over this copy and restarts the app. Your settings and data stay. Opening this page only looks the newest version up on GitHub; nothing is downloaded unless you ask." />
    <Section title="Automatic update" icon="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11">
      <SettingRow :label="t('Version {v}', { v: update?.current ?? info?.version ?? '…' })" :hint="updateLine" :warning="update?.status === 'error' ? 'Try again in a moment; the log has the details.' : undefined">
        <div class="flex items-center gap-2">
          <Button v-if="update?.status === 'available'" size="sm" intent="primary" @click="bridge().invoke('update:download')">{{ t('Install {v}', { v: update.latest ?? '' }) }}</Button>
          <Button v-else-if="update?.status === 'ready'" size="sm" intent="primary" @click="bridge().invoke('update:install')">{{ t('Restart and install') }}</Button>
          <Button
            v-else
            size="sm"
            :loading="update?.status === 'checking' || update?.status === 'downloading'"
            :disabled="update?.status === 'dev'"
            @click="bridge().invoke(update?.status === 'error' && update.latest ? 'update:download' : 'update:check')"
          >{{ update?.status === 'error' && update.latest ? t('Retry download') : t('Check for updates') }}</Button>
        </div>
      </SettingRow>
      <div v-if="update?.status === 'downloading'" class="py-3">
        <div class="h-1.5 overflow-hidden rounded-full bg-dark"><div class="h-full bg-accent transition-[width]" :style="{ width: `${update.percent}%` }" /></div>
      </div>
      <div v-if="update?.notes && (update.status === 'available' || update.status === 'downloading' || update.status === 'ready')" class="max-h-40 overflow-y-auto whitespace-pre-line py-3 text-xs text-darker">{{ update.notes.replace(/<[^>]+>/g, '') }}</div>
    </Section>

    <Section title="Manual download" icon="M3 13.5h10M8 2.5v8M5 7.5l3 3 3-3">
      <p class="pt-3 text-xs text-darker">
        {{ t('To update by hand, or if the automatic update fails: download the file, close the app, and run the installer or unpack the zip over this folder. Your settings and data stay.') }}
      </p>
      <template v-if="manual.files.length">
        <SettingRow v-for="f in manual.files" :key="f.kind" :label="f.label" :hint="f.about">
          <a :href="f.url" target="_blank" class="inline-flex h-7 items-center rounded-md border border-light px-2.5 text-xs hover:bg-dark">{{ t('Download') }}</a>
        </SettingRow>
      </template>
      <p v-else class="py-3 text-xs text-darker">{{ update?.status === 'checking' ? t('Looking up the newest version on GitHub…') : t('The newest version could not be looked up: the releases page below has every file.') }}</p>
      <SettingRow :label="manual.version ? t('Release {v} on GitHub', { v: manual.version }) : t('All releases on GitHub')" hint="The release notes, the files and their SHA-256 checksums.">
        <a :href="manual.page" target="_blank" class="inline-flex h-7 items-center rounded-md border border-light px-2.5 text-xs hover:bg-dark">{{ t('Open') }}</a>
      </SettingRow>
    </Section>

    <Section title="In this version" icon="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z">
      <ul v-if="thisVersion" class="space-y-1 py-3 text-sm text-dark">
        <li v-for="item in thisVersion.items" :key="item" class="flex gap-2">
          <span class="mt-[7px] size-1 shrink-0 rounded-full bg-darker" />
          <span>{{ t(item) }}</span>
        </li>
      </ul>
      <p v-else class="py-3 text-sm text-darker">{{ t('No notes for this version.') }}</p>
      <div class="pb-3">
        <Button size="sm" @click="emit('go', 'changes')">{{ t("Every version in What's new") }}</Button>
      </div>
    </Section>
  </div>
</template>
