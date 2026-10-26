/**
 * Playing an alert's sound (Settings → HUD): the built-in chime, a shipped mp3, or your own, whose
 * bytes main hands over (main/sounds.ts) to play from a blob URL. Asked for on each play: alerts
 * are rare, and a newly chosen mp3 then plays in every window at once.
 */
import { SOUNDS, type SoundId, type SoundSlot } from '@shared/sounds.ts'
import { bridge } from './bridge.ts'
import { playChime } from './chime.ts'

/** Play it at `volume` (0-1). False when it could not be (your own mp3 for `slot`, none chosen yet). */
export async function playSound(slot: SoundSlot, id: SoundId, volume: number): Promise<boolean> {
  const v = Math.min(1, Math.max(0, volume))
  if (id === 'chime') {
    playChime(v)
    return true
  }
  let url: string | null = SOUNDS.find((s) => s.id === id)?.file ?? null
  let blob = false
  if (id === 'custom') {
    const bytes = await bridge().invoke('sounds:custom', slot)
    if (!bytes) return false
    url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
    blob = true
  }
  if (!url) return false
  const audio = new Audio(url)
  audio.volume = v
  if (blob) audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  try {
    await audio.play()
    return true
  } catch {
    return false
  }
}
