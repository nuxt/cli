import type { Rgb, TerminalBackground } from '../../utils/terminal-theme'

import process from 'node:process'
import { styleText } from 'node:util'

import { BRAND_GREEN, resolveBackground } from '../../utils/terminal-theme'

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

  const named = tone === 'traffic' ? 'magenta' : 'green'
  // Without a known background there is no safe exact colour to pick, and
  // without truecolour no way to render one, so the terminal's palette decides.
  if (background === 'unknown' || (process.stdout.getColorDepth?.() ?? 1) < 24) {
    return styleText(lit ? named : [named, 'dim'], glyph)
  }

  const colour = tone === 'traffic' ? MAGENTA : BRAND_GREEN[known]
  const [r, g, b] = lit ? colour : blend(colour, BACKDROP[known], DIM)
  return `\u001B[38;2;${r};${g};${b}m${glyph}\u001B[39m`
}

/** Fade `colour` towards `backdrop`, which is what dimming means on either background. */
function blend(colour: Rgb, backdrop: Rgb, amount: number): Rgb {
  return colour.map((channel, index) =>
    Math.round(backdrop[index]! + (channel - backdrop[index]!) * amount),
  ) as unknown as Rgb
}
