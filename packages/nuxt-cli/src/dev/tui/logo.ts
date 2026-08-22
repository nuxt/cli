import type { Rgb, TerminalBackground } from '../../utils/terminal-theme'

import process from 'node:process'
import { styleText } from 'node:util'

import { BRAND_GREEN, colour, resolveBackground } from '../../utils/terminal-theme'

/** The mark, as four independently coloured cells. */
const PIXELS = ['⣠', '⣦', '⣠', '⡀'] as const

/** Clears 3:1 against either background, so it needs no light variant. */
const MAGENTA: Rgb = [200, 90, 200]

const BACKDROP: Record<'dark' | 'light', Rgb> = {
  dark: [0, 0, 0],
  light: [255, 255, 255],
}

/** How much of the colour is left in the cells the highlight is not on. */
const DIM = 0.35

/** How long each frame of the working animation is held. */
export const LOGO_FRAME_MS = 120

export interface LogoState {
  /** A build or restart is in progress: a highlight travels across the cells. */
  working?: boolean
  frame?: number
  /** A request was served recently: the trailing cell picks up traffic colour. */
  active?: boolean
  background?: TerminalBackground
}

/**
 * The Nuxt mark, drawn as four braille cells that double as status lights.
 *
 * The glyphs never change, so the mark cannot appear to resize; only their
 * colours move.
 */
export function renderLogo(state: LogoState = {}): string {
  const highlight = state.working ? Math.abs(state.frame ?? 0) % PIXELS.length : -1
  const background = state.background ?? resolveBackground()

  return PIXELS
    .map((pixel, index) => {
      const traffic = state.active && index === PIXELS.length - 1
      const lit = highlight < 0 || index === highlight
      return paint(pixel, traffic ? 'traffic' : 'brand', lit, background)
    })
    .join('')
}

function paint(glyph: string, tone: 'brand' | 'traffic', lit: boolean, background: TerminalBackground): string {
  const known = background === 'light' ? 'light' : 'dark'
  if (process.env.NO_COLOR) {
    return glyph
  }

  const depth = process.stdout.getColorDepth?.() ?? 1
  // Without a known background there is no safe exact colour to pick, so the
  // terminal's own palette decides.
  if (background === 'unknown' || depth < 8) {
    return styleText(lit ? named(tone) : [named(tone), 'dim'], glyph)
  }

  const exact = tone === 'traffic' ? MAGENTA : BRAND_GREEN[known]
  const shade = lit ? exact : blend(exact, BACKDROP[known], DIM)
  return `${colour(shade, depth)}${glyph}\u001B[39m`
}

function named(tone: 'brand' | 'traffic'): 'magenta' | 'green' {
  return tone === 'traffic' ? 'magenta' : 'green'
}

/** Fade `colour` towards `backdrop`, which is what dimming means on either background. */
function blend(colour: Rgb, backdrop: Rgb, amount: number): Rgb {
  return colour.map((channel, index) =>
    Math.round(backdrop[index]! + (channel - backdrop[index]!) * amount),
  ) as unknown as Rgb
}
