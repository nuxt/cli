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
export const BRAND_GREEN: Record<'dark' | 'light', Rgb> = {
  dark: [0, 220, 130],
  light: [0, 145, 92],
}

/**
 * The style secondary text takes: labels, hints, timestamps and separators.
 *
 * `dim` is an attribute rather than a colour, and terminals render it by
 * blending towards the background, so on a light terminal it leaves most of a
 * panel too faint to read. Bright black is a palette entry the user chose
 * against the background they are looking at, and it is what the rest of the
 * CLI already uses for secondary text.
 */
export const MUTED = 'gray' as const

/** Palette indices a terminal reports as its background when it is a light one. */
const LIGHT_INDICES = new Set([7, 9, 10, 11, 12, 13, 14, 15])

let asked: TerminalBackground | undefined

/**
 * Record what the terminal answered when asked, so everything painted after
 * that agrees with it.
 */
export function rememberBackground(background: TerminalBackground): void {
  asked = background
}

/**
 * Whether the terminal is showing dark text on light or the other way round.
 *
 * `unknown` until something asks: only some terminals set `COLORFGBG`, and a
 * caller that cannot wait for an answer is expected to have a choice that is
 * safe on either background rather than to guess. `nuxt dev` asks the terminal
 * directly (see `dev/tui/background.ts`) and remembers what it hears.
 */
export function resolveBackground(env: NodeJS.ProcessEnv = process.env): TerminalBackground {
  const override = env.NUXT_TERM_THEME?.trim().toLowerCase()
  if (override === 'dark' || override === 'light') {
    return override
  }
  if (asked) {
    return asked
  }

  const reported = env.COLORFGBG?.split(';').at(-1)?.trim()
  if (!reported || !/^\d+$/.test(reported)) {
    return 'unknown'
  }
  return LIGHT_INDICES.has(Number(reported)) ? 'light' : 'dark'
}

/**
 * Amber for a warning accent, and the darker one it becomes on a light
 * terminal.
 *
 * ANSI yellow manages about 1.5:1 on white, which makes it a decoration rather
 * than something anyone can read.
 */
export const WARNING_AMBER: Record<'dark' | 'light', Rgb> = {
  dark: [255, 200, 87],
  light: [138, 90, 0],
}

const TONES = {
  brand: { fallback: 'green', exact: BRAND_GREEN },
  warning: { fallback: 'yellow', exact: WARNING_AMBER },
} satisfies Record<string, { fallback: Parameters<typeof styleText>[0], exact: Record<'dark' | 'light', Rgb> }>

export type Tone = keyof typeof TONES

/** The intensities the 256-colour cube is built from. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255]

/**
 * Write `text` in one of the CLI's own colours, as close to it as the terminal
 * can be trusted to render legibly.
 *
 * Without a known background there is no safe exact colour, so the terminal's
 * own palette decides: the user chose it against the background they are
 * looking at. Once the background is known, the colour is either exact or the
 * nearest the terminal can hold.
 */
export function paint(tone: Tone, text: string, background = resolveBackground()): string {
  const { fallback, exact } = TONES[tone]
  const depth = process.stdout.getColorDepth?.() ?? 1
  if (background === 'unknown' || depth < 8) {
    return styleText(fallback, text)
  }
  if (process.env.NO_COLOR || !process.stdout.hasColors?.()) {
    return text
  }
  return `${colour(exact[background], depth)}${text}\u001B[39m`
}

/** The escape that comes closest to `rgb` at this colour depth. */
export function colour([r, g, b]: Rgb, depth = process.stdout.getColorDepth?.() ?? 1): string {
  if (depth >= 24) {
    return `\u001B[38;2;${r};${g};${b}m`
  }
  const level = (channel: number) => CUBE_LEVELS.reduce(
    (best, value, index) => Math.abs(value - channel) < Math.abs(CUBE_LEVELS[best]! - channel) ? index : best,
    0,
  )
  return `\u001B[38;5;${16 + 36 * level(r) + 6 * level(g) + level(b)}m`
}
