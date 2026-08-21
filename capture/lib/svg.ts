import type { Style } from 'ansivision'

export interface Frame {
  /** Milliseconds from the start of the recording. */
  at: number
  lines: string[]
  styles: Style[][]
}

export interface SvgOptions {
  columns: number
  rows: number
  title: string
  /** Description of the scrubbing that was applied, embedded in the artifact. */
  scrubbed: string
  animated: boolean
  /** Total loop duration in ms, only used for animated output. */
  duration?: number
  fontSize?: number
}

const CHAR_WIDTH_RATIO = 0.6
const LINE_HEIGHT_RATIO = 1.4
const PADDING = 16
const CHROME_HEIGHT = 32
/** Gradient border around the terminal card, for social media embeds. */
const MARGIN = 32

const LIGHT_PALETTE = ['#24292f', '#cf222e', '#116329', '#8a6300', '#0969da', '#8250df', '#1b7c83', '#57606a', '#57606a', '#a40e26', '#0e7a34', '#7d4e00', '#0550ae', '#6639ba', '#136c72', '#24292f']
const DARK_PALETTE = ['#c9d1d9', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#8b949e', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc']

function paletteColor(index: number, dark: boolean): string {
  if (index < 16) {
    return (dark ? DARK_PALETTE : LIGHT_PALETTE)[index]!
  }
  if (index < 232) {
    const level = [0, 95, 135, 175, 215, 255]
    const n = index - 16
    return rgb(level[Math.floor(n / 36) % 6]!, level[Math.floor(n / 6) % 6]!, level[n % 6]!)
  }
  const grey = 8 + (index - 232) * 10
  return rgb(grey, grey, grey)
}

function rgb(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function colorValue(color: Style['foreground'], dark: boolean): string | undefined {
  if (color === null || color === undefined) {
    return undefined
  }
  if (typeof color === 'number') {
    return paletteColor(color, dark)
  }
  return rgb(color[0], color[1], color[2])
}

const DEFAULT_STYLE: Style = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  hidden: false,
  strikethrough: false,
  foreground: null,
  background: null,
}

interface Run {
  col: number
  text: string
  style: Style
}

function runsForLine(line: string, styles: Style[] | undefined): Run[] {
  const runs: Run[] = []
  let current: Run | undefined
  for (let col = 0; col < line.length; col++) {
    const style = styles?.[col]
    const key = style ? styleKey(style) : ''
    if (!current || styleKey(current.style) !== key) {
      if (current && current.text.trim() !== '') {
        runs.push(current)
      }
      else if (current && current.style.background !== null) {
        runs.push(current)
      }
      current = { col, text: '', style: style ?? DEFAULT_STYLE }
    }
    current.text += line[col]
  }
  if (current && (current.text.trim() !== '' || current.style.background !== null)) {
    runs.push(current)
  }
  return runs
}

function styleKey(style: Style): string {
  return JSON.stringify([style.foreground, style.background, style.bold, style.dim, style.italic, style.underline, style.inverse, style.strikethrough])
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderFrame(frame: Frame, options: Required<Pick<SvgOptions, 'columns' | 'rows' | 'fontSize'>>): string {
  const charWidth = options.fontSize * CHAR_WIDTH_RATIO
  const lineHeight = options.fontSize * LINE_HEIGHT_RATIO
  const parts: string[] = []

  for (let row = 0; row < Math.min(frame.lines.length, options.rows); row++) {
    const line = frame.lines[row]!.slice(0, options.columns)
    const runs = runsForLine(line, frame.styles[row])
    if (runs.length === 0) {
      continue
    }
    const y = PADDING + CHROME_HEIGHT + (row + 1) * lineHeight - lineHeight * 0.25
    const spans: string[] = []
    for (const run of runs) {
      const x = PADDING + run.col * charWidth
      const classes: string[] = []
      if (run.style.bold) {
        classes.push('b')
      }
      if (run.style.italic) {
        classes.push('i')
      }
      if (run.style.underline) {
        classes.push('u')
      }
      if (run.style.dim) {
        classes.push('d')
      }
      const foreground = run.style.inverse ? run.style.background : run.style.foreground
      const background = run.style.inverse ? run.style.foreground : run.style.background
      let fill = ''
      if (foreground !== null) {
        if (typeof foreground === 'number' && foreground < 16) {
          classes.push(`c${foreground}`)
        }
        else {
          fill = ` fill="${colorValue(foreground, false)}"`
        }
      }
      if (background !== null) {
        // Palette colors 0-15 differ between the light and dark themes, so
        // they go through a class; anything else renders identically in both.
        const fillAttribute = typeof background === 'number' && background < 16
          ? ` class="g${background}"`
          : ` fill="${colorValue(background, false)}"`
        parts.push(`<rect x="${x.toFixed(1)}" y="${(y - lineHeight * 0.75).toFixed(1)}" width="${(run.text.length * charWidth).toFixed(1)}" height="${lineHeight.toFixed(1)}"${fillAttribute}/>`)
      }
      const classAttribute = classes.length ? ` class="${classes.join(' ')}"` : ''
      // Each run starts at an absolute x on a 0.6em column grid, but glyphs
      // inside a run advance at the viewer font's real width. If that is not
      // exactly 0.6em, a long run drifts and the next run's snapped x lands on
      // top of it, visually swallowing the space between them. textLength
      // forces every run onto the grid regardless of the font.
      spans.push(`<tspan x="${x.toFixed(1)}" textLength="${(run.text.length * charWidth).toFixed(1)}" lengthAdjust="spacingAndGlyphs"${classAttribute}${fill}>${escapeText(run.text)}</tspan>`)
    }
    parts.push(`<text y="${y.toFixed(1)}">${spans.join('')}</text>`)
  }
  return parts.join('')
}

export function toSvg(frames: Frame[], options: SvgOptions): string {
  const fontSize = options.fontSize ?? 14
  const charWidth = fontSize * CHAR_WIDTH_RATIO
  const lineHeight = fontSize * LINE_HEIGHT_RATIO
  const cardWidth = Math.ceil(options.columns * charWidth + PADDING * 2)
  const cardHeight = Math.ceil(options.rows * lineHeight + PADDING * 2 + CHROME_HEIGHT)
  const width = cardWidth + MARGIN * 2
  const height = cardHeight + MARGIN * 2
  const geometry = { columns: options.columns, rows: options.rows, fontSize }

  const duration = options.duration ?? (frames.at(-1)?.at ?? 0) + 1200
  const groups = frames.map((frame, index) => {
    const body = renderFrame(frame, geometry)
    if (!options.animated) {
      return body
    }
    const start = frame.at / duration
    const end = index + 1 < frames.length ? frames[index + 1]!.at / duration : 1
    const last = index + 1 === frames.length
    // Frames must cut, not crossfade: SMIL interpolates linearly between
    // keyframes, so without a zero keyframe right after `end` a frame would
    // fade out over the rest of the loop, ghosting on top of later frames.
    const keyTimes = [0, Math.max(start - 0.0001, 0), start, Math.min(end, 1), Math.min(end + 0.0001, 1), 1]
    const values = [0, 0, 1, 1, last ? 1 : 0, last ? 1 : 0]
    return [
      `<g opacity="0">`,
      `<animate attributeName="opacity" values="${values.join(';')}" keyTimes="${keyTimes.map(t => t.toFixed(4)).join(';')}" dur="${(duration / 1000).toFixed(2)}s" repeatCount="indefinite"/>`,
      body,
      `</g>`,
    ].join('')
  })

  const colorRules = Array.from({ length: 16 }, (_, index) => `.c${index}{fill:${LIGHT_PALETTE[index]}}.g${index}{fill:${LIGHT_PALETTE[index]}}`).join('')
  const darkColorRules = Array.from({ length: 16 }, (_, index) => `.c${index}{fill:${DARK_PALETTE[index]}}.g${index}{fill:${DARK_PALETTE[index]}}`).join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,&quot;DejaVu Sans Mono&quot;,monospace" font-size="${fontSize}">`,
    `<title>${escapeText(options.title)}</title>`,
    `<desc>Terminal capture. Scrubbing applied: ${escapeText(options.scrubbed)}</desc>`,
    `<style>`,
    `text{white-space:pre;fill:var(--fg)}`,
    `.b{font-weight:700}.i{font-style:italic}.u{text-decoration:underline}.d{opacity:.7}`,
    `svg{--bg:#ffffff;--fg:#24292f;--chrome:#f6f8fa;--dot:#d0d7de}`,
    colorRules,
    `@media (prefers-color-scheme:dark){svg{--bg:#0d1117;--fg:#c9d1d9;--chrome:#161b22;--dot:#30363d}${darkColorRules}}`,
    `</style>`,
    `<defs><linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(40,89,148)"/><stop offset="1" stop-color="rgb(79,0,126)"/></linearGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#backdrop)"/>`,
    `<g transform="translate(${MARGIN},${MARGIN})">`,
    `<rect width="${cardWidth}" height="${cardHeight}" rx="8" fill="var(--bg)"/>`,
    `<rect width="${cardWidth}" height="${CHROME_HEIGHT}" rx="8" fill="var(--chrome)"/>`,
    `<rect y="${CHROME_HEIGHT - 8}" width="${cardWidth}" height="8" fill="var(--chrome)"/>`,
    [0, 1, 2].map(index => `<circle cx="${18 + index * 18}" cy="${CHROME_HEIGHT / 2}" r="5" fill="var(--dot)"/>`).join(''),
    `<text x="${cardWidth / 2}" y="${CHROME_HEIGHT / 2 + 4}" text-anchor="middle" font-size="${fontSize - 2}" opacity=".6">${escapeText(options.title)}</text>`,
    ...groups,
    `</g>`,
    `</svg>`,
    '',
  ].join('\n')
}
