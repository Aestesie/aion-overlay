/**
 * Keys that work while the game is in front (registered with Windows, so the game does not get
 * them while the app runs):
 *
 *   Alt+E        open the dashboard
 *   Alt+Shift+E  every overlay off, or back on (the dashboard is left as it is)
 */
import { globalShortcut } from 'electron'
import { log } from './tracker.ts'
import { showPanel, toggleOverlays } from './windows.ts'

const KEYS: { accelerator: string; run: () => void }[] = [
  { accelerator: 'Alt+E', run: () => showPanel() },
  {
    accelerator: 'Alt+Shift+E',
    run: () => log(`overlays ${toggleOverlays() ? 'hidden' : 'shown'} (Alt+Shift+E)`),
  },
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
