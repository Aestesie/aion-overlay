/**
 * The PvP overlays' panel (the kill feed, Enemies nearby): its background at the opacity set on the
 * PvP page, from fully see-through (0: no panel at all, the text glows on the game) to solid. The
 * border fades with it.
 */
export function panelStyle(opacity: number, border = '39 39 42'): Record<string, string> {
  const o = Math.min(1, Math.max(0, opacity))
  return {
    background: `rgb(9 9 11 / ${o})`,
    borderColor: `rgb(${border} / ${Math.min(1, o * 1.4)})`,
    boxShadow: o > 0.3 ? '0 8px 24px rgb(0 0 0 / 0.35)' : 'none',
  }
}
