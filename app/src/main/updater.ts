/**
 * App updates, only when asked (Settings → Updates): electron-updater reads the latest release of
 * github.com/erylopez/aion-overlay (the latest.yml the build attaches to it), downloads the
 * installer and runs it over this copy, then starts the app again. Nothing is checked or downloaded
 * by itself. Its requests go through electron-updater's own session, not the windows' one that
 * main/index.ts blocks.
 *
 * The portable copy (the zip, unpacked anywhere) has no installer to run: it checks the same way,
 * and Download opens the release page for the new zip instead.
 */
import { app, shell } from 'electron'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import electronUpdater from 'electron-updater'
import { broadcast } from './broadcast.ts'
import { log } from './tracker.ts'
import type { UpdateState } from '../shared/update.ts'

// electron-updater is CommonJS: its named exports sit on the default import in the ESM build.
const { autoUpdater } = electronUpdater

const REPO = { owner: 'erylopez', repo: 'aion-overlay' }
/** An installed copy has its uninstaller next to it ("Uninstall Lokthar.exe"); one unpacked from the zip does not. */
function isPortable(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false
  try {
    return !readdirSync(dirname(app.getPath('exe'))).some((f) => /^Uninstall .+\.exe$/i.test(f))
  } catch {
    return false
  }
}
const portable = isPortable()

let state: UpdateState = {
  status: app.isPackaged ? 'idle' : 'dev',
  current: app.getVersion(),
  latest: null,
  releasedAt: null,
  notes: null,
  percent: 0,
  error: null,
  checkedAt: null,
  portable,
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast('update:state', state)
}

const notesText = (notes: unknown): string | null =>
  typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : null

export function startUpdater(): void {
  // What electron-builder's publish says (app-update.yml), said here too, for the zip's copy.
  if (portable) autoUpdater.setFeedURL({ provider: 'github', ...REPO, releaseType: 'release' })
  autoUpdater.autoDownload = false
  // A downloaded update the user did not restart for goes in when the app quits.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => log(`update: ${String(m)}`), warn: (m: unknown) => log(`update: ${String(m)}`), error: (m: unknown) => log(`update: ${String(m)}`), debug: () => undefined }
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'available', latest: info.version, releasedAt: info.releaseDate ?? null, notes: notesText(info.releaseNotes), checkedAt: Date.now() }),
  )
  autoUpdater.on('update-not-available', (info) => set({ status: 'current', latest: info.version, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => set({ status: 'ready', percent: 100 }))
  autoUpdater.on('error', (err) => set({ status: 'error', error: err?.message ?? String(err), checkedAt: Date.now() }))
}

export const updater = {
  get: (): UpdateState => state,
  check(): void {
    if (state.status === 'dev' || state.status === 'checking' || state.status === 'downloading') return
    void autoUpdater.checkForUpdates().catch((err: unknown) => set({ status: 'error', error: String(err) }))
  },
  download(): void {
    if (state.status !== 'available' && state.status !== 'error') return
    if (portable) {
      const tag = state.latest ? `tag/v${state.latest}` : 'latest'
      void shell.openExternal(`https://github.com/${REPO.owner}/${REPO.repo}/releases/${tag}`)
      return
    }
    set({ status: 'downloading', percent: 0, error: null })
    void autoUpdater.downloadUpdate().catch((err: unknown) => set({ status: 'error', error: String(err) }))
  },
  /** Close, install silently over this copy, and start again. */
  install(): void {
    if (state.status !== 'ready') return
    log('update: restarting to install')
    autoUpdater.quitAndInstall(true, true)
  },
}
