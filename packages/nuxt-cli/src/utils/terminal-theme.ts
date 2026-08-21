import process from 'node:process'
import { styleText } from 'node:util'

export type TerminalBackground = 'dark' | 'light' | 'unknown'

export type Rgb = readonly [number, number, number]

/**
 * Nuxt green, and the darker green it becomes on a light terminal.
 *
 * `#00DC82` is bright enough to all but disappear on white (a contrast ratio
 * of about 1.8:1), so the light variant trades some of the glow for a ratio
 * above 4:1.
 */
const BRAND_GREEN: Record<'dark' | 'light', Rgb> = {
  dark: [0, 220, 130],
  light: [0, 145, 92],
}

/** Palette indices a terminal reports as its background when it is a light one. */
const LIGHT_INDICES = new Set([7, 9, 10, 11, 12, 13, 14, 15])

/**
 * Whether the terminal is showing dark text on light or the other way round.
 *
 * `unknown` is the common answer: only some terminals set `COLORFGBG`, and
 * asking the terminal directly (OSC 11) means writing to stdout and waiting
 * for a reply that may never come. Callers are expected to have a choice that
 * is safe on either background rather than to guess.
 */
function resolveBackground(env: NodeJS.ProcessEnv = process.env): TerminalBackground {
  const override = env.NUXT_TERM_THEME?.trim().toLowerCase()
  if (override === 'dark' || override === 'light') {
    return override
  }

  const reported = env.COLORFGBG?.split(';').at(-1)?.trim()
  if (!reported || !/^\d+$/.test(reported)) {
    return 'unknown'
  }
  return LIGHT_INDICES.has(Number(reported)) ? 'light' : 'dark'
}

/**
 * Write `text` in Nuxt green, as close to it as the terminal can be trusted to
 * render legibly.
 *
 * Without a known background there is no safe exact colour, so the terminal's
 * own palette decides: the user chose it against the background they are
 * looking at.
 */
export function paintBrand(text: string, background = resolveBackground()): string {
  if (background === 'unknown' || (process.stdout.getColorDepth?.() ?? 1) < 24) {
    return styleText('green', text)
  }
  if (process.env.NO_COLOR || !process.stdout.hasColors?.()) {
    return text
  }
  const [r, g, b] = BRAND_GREEN[background]
  return `\u001B[38;2;${r};${g};${b}m${text}\u001B[39m`
}
