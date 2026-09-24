import { DEFAULT_THEME, themeColors } from '../../../vendor/lazy-kit/themes.js'

// One view per process; each render swaps in the palette before drawing.
// Stable object mutated in place: every view module shares this reference, so
// the per-frame swap applies everywhere without threading COLORS through calls.
export const COLORS = { ...themeColors(DEFAULT_THEME) }

export function setTheme(id) {
  Object.assign(COLORS, themeColors(id))
}
