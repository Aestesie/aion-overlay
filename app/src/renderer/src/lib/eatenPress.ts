/**
 * Clicks on an overlay while the game is in front. Windows can eat the mouse-down on a window it
 * activates over the game and pass on only the release (traced on the bubble 2026-10-10: pointerup
 * and mouseup arrived, pointerdown never), and with no press there is no click: the meter's
 * switches and buttons showed on hover but never took a click. A release with no press before it
 * is made a click on what it landed on (a select opens its list).
 *
 * The bubble does this itself (windowDrag's onPointerUp), so it is not installed there.
 */
export function clickEatenPresses(): void {
  /** A press this window saw, whose release it is waiting for. */
  let pressed = false
  document.addEventListener('pointerdown', () => (pressed = true), true)
  document.addEventListener(
    'pointerup',
    (e) => {
      const had = pressed
      pressed = false
      if (had || e.button !== 0 || !(e.target instanceof HTMLElement)) return
      const target = e.target
      if (target instanceof HTMLSelectElement) {
        target.focus()
        try {
          target.showPicker()
        } catch {
          // Not allowed without a gesture Chromium counts: the select just takes the focus.
        }
        return
      }
      if (target.closest('button:disabled')) return
      target.click()
    },
    true,
  )
}
