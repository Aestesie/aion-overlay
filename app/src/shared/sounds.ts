/**
 * The alert sounds (Settings → HUD): for a Hidden Cube coming into view, and for an enemy player.
 * Each picks the built-in chime, one shipped in renderer/public/sounds, or an mp3 of your own,
 * copied into the app's data folder (main/sounds.ts) so it stays when the original is moved.
 */
export const SOUNDS = [
  { id: 'chime', label: 'Chime', file: null },
  { id: 'enemy-spotted', label: 'Enemy spotted', file: 'sounds/enemy-spotted.mp3' },
  { id: 'button', label: 'Button', file: 'sounds/button.mp3' },
  { id: 'click', label: 'Click', file: 'sounds/click.mp3' },
  { id: 'bell', label: 'Bell', file: 'sounds/bell.mp3' },
  { id: 'custom', label: 'Your own mp3', file: null },
] as const

export type SoundId = (typeof SOUNDS)[number]['id']

export const isSound = (v: unknown): v is SoundId => SOUNDS.some((s) => s.id === v)

/** What a sound is for: each has its own choice, volume and mp3 of your own. */
export type SoundSlot = 'cube' | 'enemy'
export const isSoundSlot = (v: unknown): v is SoundSlot => v === 'cube' || v === 'enemy'

/** The largest mp3 taken as your own sound: an alert, not a song. */
export const CUSTOM_SOUND_MAX_BYTES = 2 * 1024 * 1024

/** What choosing your own mp3 came to: its name, or why it was not taken (null: cancelled). */
export type CustomSoundResult = { ok: true; name: string } | { ok: false; error: string } | null
