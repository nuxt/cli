import type { OverlayEntry } from './screen'

import { styleText } from 'node:util'

import { MUTED } from '../../utils/terminal-theme'

import { formatHints, ScreenOverlay } from './screen'

export interface HelpEntry {
  keys: string[]
  ctrl?: string
  description: string
}

const VIEW_ENTRIES: HelpEntry[] = [
  { keys: ['↑ / k', '↓ / j'], description: 'select an entry' },
  { keys: ['Page Up', 'Page Down'], description: 'scroll a screenful' },
  { keys: ['Home', 'g'], description: 'go to the beginning' },
  { keys: ['End', 'G'], description: 'follow the latest entries' },
  { keys: ['y'], description: 'copy the selected entry' },
  { keys: ['enter'], description: 'open details, otherwise copy' },
  { keys: ['Y'], description: 'copy the whole view' },
  { keys: ['/'], description: 'search (enter applies, esc cancels)' },
  { keys: ['esc', 'q'], description: 'close or go back; opening key also closes' },
]

/** Keyboard shortcut reference. */
export class HelpOverlay extends ScreenOverlay {
  #entries: () => HelpEntry[]

  constructor(entries: () => HelpEntry[], write: (chunk: string) => void, onClose: () => void) {
    super({ write, onClose })
    this.#entries = entries
  }

  open(): void {
    if (this.isOpen) {
      return
    }
    super.open()
    this.select(0)
    this.repaint()
  }

  protected get closeKeys(): readonly string[] {
    return ['h', '?']
  }

  protected renderTitle(): string {
    return ` ${styleText('bold', 'keyboard shortcuts')}`
  }

  protected renderEntries(): OverlayEntry[] {
    const entries = this.#entries()
    const width = Math.max(...[...entries, ...VIEW_ENTRIES].map(entry => formatKeys(entry).length))
    const row = (entry: HelpEntry): OverlayEntry => ({
      lines: [`${styleText('bold', formatKeys(entry).padEnd(width))}   ${styleText(MUTED, entry.description)}`],
    })
    return [
      { lines: [styleText('bold', 'global')] },
      ...entries.filter(entry => entry.ctrl).map(row),
      { lines: ['', styleText('bold', 'main panel')] },
      ...entries.filter(entry => !entry.ctrl).map(row),
      { lines: ['', styleText('bold', 'in a view')] },
      ...VIEW_ENTRIES.map(row),
    ]
  }

  protected renderHints(columns: number): string {
    return formatHints([['↑/↓', 'select'], ['PgUp/PgDn', 'scroll'], ['esc/q', 'close']], columns)
  }
}

function formatKeys({ keys, ctrl }: HelpEntry): string {
  const named = keys.map(key => /^[A-Z]$/.test(key) ? `shift-${key.toLowerCase()}` : key)
  return [...named, ...ctrl ? [`ctrl-${ctrl}`] : []].join(' / ')
}
