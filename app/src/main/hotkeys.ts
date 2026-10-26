/**
 * Keys that work while the game is in front (registered with Windows, so the game does not get
 * them while the app runs):
 *
 *   Alt+E        open the dashboard, or put it away when it is up
 *   Alt+Shift+E  every overlay off, or back on (the dashboard is left as it is)
 *   Alt+Shift+R  start or stop the packet log (Settings → Developer), with a pill over the game
 */
import { globalShortcut } from 'electron'
import { packets } from './packets.ts'
import { log } from './tracker.ts'
import { toggleOverlays, togglePanel } from './windows.ts'

const KEYS: { accelerator: string; run: () => void }[] = [
  { accelerator: 'Alt+E', run: () => togglePanel() },
  {
    accelerator: 'Alt+Shift+E',
    run: () => log(`overlays ${toggleOverlays() ? 'hidden' : 'shown'} (Alt+Shift+E)`),
  },
  { accelerator: 'Alt+Shift+R', run: () => packets.set(!packets.get().on) },
]

export function startHotkeys(): void {
  for (const { accelerator, run } of KEYS) {
    // Another program may hold the key already: then it is only in the tray menu.
    if (!globalShortcut.register(accelerator, run)) log(`hotkey ${accelerator} is taken by another program`)
  }
}

export function stopHotkeys(): void {
  globalShortcut.unregisterAll()
}
