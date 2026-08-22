import type { OverlayEntry } from './screen'

import { styleText } from 'node:util'

import { MUTED } from '../../utils/terminal-theme'

import { formatHints, ScreenOverlay } from './screen'
import { stripAnsi, visibleWidth } from './width'

export interface InfoSection {
  heading: string
  entries: Array<[label: string, value: string | undefined, style?: Parameters<typeof styleText>[0]]>
}

/** Columns needed before a side panel is worth splitting the view into. */
const SIDE_PANEL_MIN_GAP = 8

/** Values matching these are coloured, so the view stays scannable. */
const VALUE_STYLES: Array<{ pattern: RegExp, style: Parameters<typeof styleText>[0] }> = [
  { pattern: /^https?:\/\//, style: 'cyan' },
  { pattern: /^\d[\w.\-+]*$/, style: 'green' },
]

/** Versions, every URL the session is reachable on, and how it has behaved. */
export class InfoOverlay extends ScreenOverlay {
  #sections: () => InfoSection[]
  #panel: () => string | undefined

  constructor(
    sections: () => InfoSection[],
    write: (chunk: string) => void,
    onClose: () => void,
    panel: () => string | undefined = () => undefined,
  ) {
    super({
      write,
      onClose,
      // Uptime would otherwise freeze at the moment the view was opened.
      subscribe: (listener) => {
        const timer = setInterval(listener, 1000)
        timer.unref?.()
        return () => clearInterval(timer)
      },
    })
    this.#sections = sections
    this.#panel = panel
  }

  protected get closeKeys(): readonly string[] {
    return ['i', 'u']
  }

  protected renderTitle(): string {
    return ` ${styleText('bold', 'info')}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    const sections = this.#sections()
    const width = Math.max(...sections.flatMap(({ entries }) => entries.map(([label]) => label.length)))

    const rows = sections.flatMap(({ heading, entries }, index) => [
      ...index > 0 ? [''] : [],
      `  ${styleText(['bold', 'underline'], heading)}`,
      ...entries
        .filter(([, value]) => !!value)
        .map(([label, value, style]) => `  ${styleText(MUTED, label.padEnd(width))}  ${style ? styleText(style, value!) : colorize(value!)}`),
    ])

    return withSidePanel(rows, this.#panel(), columns).map(line => ({
      lines: [line],
      // Copying a whole info screen is rarely useful; a single value is.
      copy: stripAnsi(line).trim().split(/\s{2,}/).at(-1),
    }))
  }

  protected renderHints(columns: number): string {
    return formatHints([['q', 'close']], columns)
  }
}

/**
 * Place `panel` to the right of `rows` when the terminal is wide enough for
 * both, and underneath when it is not.
 */
function withSidePanel(rows: string[], panel: string | undefined, columns: number): string[] {
  if (!panel) {
    return rows
  }
  const panelLines = panel.split('\n')
  const panelWidth = Math.max(...panelLines.map(line => visibleWidth(line)))
  const contentWidth = Math.max(...rows.map(line => visibleWidth(line)))

  if (columns < contentWidth + panelWidth + SIDE_PANEL_MIN_GAP) {
    return [...rows, '', ...panelLines.map(line => `  ${line}`)]
  }

  const gutter = contentWidth + 4
  return Array.from({ length: Math.max(rows.length, panelLines.length) }, (_, index) => {
    const left = rows[index] ?? ''
    const right = panelLines[index]
    return right ? `${left}${' '.repeat(gutter - visibleWidth(left))}${right}` : left
  })
}

/** Leave values that already carry styling alone; colour the plain ones by shape. */
function colorize(value: string): string {
  if (value.includes('\u001B[')) {
    return value
  }
  const match = VALUE_STYLES.find(({ pattern }) => pattern.test(value))
  return match ? styleText(match.style, value) : value
}
