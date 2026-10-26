/**
 * Your own alert sounds (Settings → HUD), one per alert (a Hidden Cube, an enemy): an mp3 you
 * choose, copied into `<userData>/sounds/<slot>-custom.mp3`, so it stays when the original is
 * moved or deleted. Only its name goes in the settings; the windows ask for its bytes to play it
 * (they load no files from disk themselves).
 */
import { app, BrowserWindow, dialog } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { settings } from './settings.ts'
import { log } from './tracker.ts'
import { CUSTOM_SOUND_MAX_BYTES, isSoundSlot, type CustomSoundResult, type SoundSlot } from '../shared/sounds.ts'

const file = (slot: SoundSlot): string => join(app.getPath('userData'), 'sounds', `${slot}-custom.mp3`)

/** An mp3 starts with its ID3 tag, or straight away with an MPEG audio frame (11 bits set). */
function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length < 4) return false
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true
  return b[0] === 0xff && (b[1]! & 0xe0) === 0xe0
}

export const sounds = {
  /** Ask for an mp3, check it, and keep a copy as that alert's sound. */
  async pickCustom(slot: unknown): Promise<CustomSoundResult> {
    if (!isSoundSlot(slot)) return { ok: false, error: 'unknown alert' }
    const parent = BrowserWindow.getFocusedWindow()
    const options = { title: slot === 'cube' ? 'Choose a sound for Hidden Cubes' : 'Choose a sound for enemies nearby', filters: [{ name: 'MP3 audio', extensions: ['mp3'] }], properties: ['openFile' as const] }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const from = picked.filePaths[0]
    if (picked.canceled || !from) return null
    try {
      const size = (await stat(from)).size
      if (size > CUSTOM_SOUND_MAX_BYTES) return { ok: false, error: `that file is ${(size / 1048576).toFixed(1)} MB: up to ${CUSTOM_SOUND_MAX_BYTES / 1048576} MB` }
      const bytes = await readFile(from)
      if (!looksLikeMp3(bytes)) return { ok: false, error: 'that file is not an mp3' }
      await mkdir(join(app.getPath('userData'), 'sounds'), { recursive: true })
      await writeFile(file(slot), bytes)
      const name = basename(from)
      if (slot === 'cube') settings.set('hud', { ...settings.get('hud'), cubeSoundId: 'custom', cubeCustomName: name })
      else settings.set('enemies', { ...settings.get('enemies'), soundId: 'custom', customName: name })
      log(`${slot} sound: ${name} (${size} bytes)`)
      return { ok: true, name }
    } catch (err) {
      return { ok: false, error: `could not copy it: ${(err as Error).message}` }
    }
  },

  /** Your mp3, to play: null when none was chosen (or it was deleted from the data folder). */
  async custom(slot: unknown): Promise<Uint8Array | null> {
    if (!isSoundSlot(slot)) return null
    try {
      return new Uint8Array(await readFile(file(slot)))
    } catch {
      return null
    }
  },
}
