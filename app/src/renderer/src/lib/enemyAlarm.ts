/**
 * The enemy alarm: a sound when an enemy comes into view (only one who can attack you, unless set
 * otherwise: in the Abyss that is every one). Not again for the same player within a minute (they
 * step in and out of range), and not more than once every 5 s however many arrive. Enemies nearby
 * sounds it; the Unified HUD does while it stands in for that overlay.
 */
import { watch } from 'vue'
import { playSound } from '@/lib/sound.ts'
import { useApp } from '@/stores/app.ts'
import { canAttack } from '@shared/tracker.ts'

const AGAIN_MS = 60_000
const GAP_MS = 5_000

export function useEnemyAlarm(active: () => boolean = () => true): void {
  const store = useApp()
  const heard = new Map<string, number>()
  let lastSound = 0
  watch(
    () => store.enemies,
    (now) => {
      const cfg = store.settings.enemies
      const t = Date.now()
      const alarming = cfg.pvpOnly ? now.filter((e) => canAttack(e)) : now
      const fresh = alarming.filter((e) => t - (heard.get(e.name) ?? 0) > AGAIN_MS)
      for (const e of alarming) heard.set(e.name, t)
      if (!fresh.length || !active() || !store.ready || !cfg.sound || t - lastSound < GAP_MS) return
      lastSound = t
      void playSound('enemy', cfg.soundId, cfg.volume)
    },
  )
}
