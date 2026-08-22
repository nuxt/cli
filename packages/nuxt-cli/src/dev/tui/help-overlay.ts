import type { OverlayEntry } from './screen'

import { styleText } from 'node:util'

import { MUTED } from '../../utils/terminal-theme'

import { formatHints, ScreenOverlay } from './screen'

export interface HelpEntry {
  keys: string[]
  /** The key that does the same thing when held with control. */
  ctrl?: string
  description: string
}

/** The keyboard shortcuts, as a view rather than a wall of log output. */
export class HelpOverlay extends ScreenOverlay {
  #entries: () => HelpEntry[]

  constructor(entries: () => HelpEntry[], write: (chunk: string) => void, onClose: () => void) {
    super({ write, onClose })
    this.#entries = entries
  }

  protected get closeKeys(): readonly string[] {
    return ['h']
  }

  protected renderTitle(): string {
    return ` ${styleText('bold', 'keyboard shortcuts')}`
  }

  protected renderEntries(): OverlayEntry[] {
    const entries = this.#entries()
    const width = Math.max(...entries.map(entry => formatKeys(entry).length))
    return entries.map(entry => ({
      lines: [`${styleText('bold', formatKeys(entry).padEnd(width))}   ${styleText(MUTED, entry.description)}`],
    }))
  }

  protected renderHints(columns: number): string {
    return formatHints([['q', 'close']], columns)
  }
}

/** Keys as a user presses them, with shifted letters spelled out. */
function formatKeys({ keys, ctrl }: HelpEntry): string {
  const named = keys.map(key => /^[A-Z]$/.test(key) ? `shift-${key.toLowerCase()}` : key)
  return [...named, ...ctrl ? [`ctrl-${ctrl}`] : []].join(' / ')
}
