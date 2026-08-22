import type { Key } from './keys'

import process from 'node:process'
import { styleText } from 'node:util'

import { MUTED, paint } from '../../utils/terminal-theme'

import { stripAnsi, truncate, visibleWidth } from './width'

const RENDER_DELAY_MS = 50

/** How long a copy confirmation stays in the hint line. */
const NOTICE_MS = 2000

/** Marks the selected entry; the same width is reserved on every row. */
const SELECTED_GUTTER = '▎ '
const GUTTER = '  '
const GUTTER_WIDTH = 2

export interface OverlayEntry {
  lines: string[]
  /** Plain text put on the clipboard when this entry is copied. */
  copy?: string
}

const ENTER_ALT = '\u001B[?1049h\u001B[?25l'
const LEAVE_ALT = '\u001B[?25h\u001B[?1049l'

/**
 * A full-screen view in the alternate buffer.
 *
 * Entering and leaving never disturbs the real scrollback, so a view can own the
 * whole terminal for as long as it is open. Subclasses supply the content and
 * any keys of their own; scrolling, throttled repaints, search, copying and the
 * buffer switch are handled here.
 */
export abstract class ScreenOverlay {
  #write: (chunk: string) => void
  #onClose: () => void
  #subscribe: (listener: () => void) => () => void
  #open = false
  #offset = 0
  #renderTimer?: NodeJS.Timeout
  #unsubscribe?: () => void
  #onResize = () => this.#scheduleRender()
  #query = ''
  #searching = false
  #selected?: number
  #notice?: { text: string, until: number }

  constructor(options: {
    write: (chunk: string) => void
    onClose: () => void
    /** Register for changes to the underlying data; returns an unsubscribe. */
    subscribe?: (listener: () => void) => () => void
  }) {
    this.#write = options.write
    this.#onClose = options.onClose
    this.#subscribe = options.subscribe ?? (() => () => {})
  }

  /** The title line; a rule is drawn under it. */
  protected abstract renderTitle(columns: number): string
  /** Entries, oldest first. The tail is shown unless the view is scrolled. */
  protected abstract renderEntries(columns: number): OverlayEntry[]
  protected abstract renderHints(columns: number): string
  /** Keys that close the view, alongside `q` and `escape`. */
  protected abstract get closeKeys(): readonly string[]

  /** Handle a view-specific key; return `true` if it changed anything. */
  protected handleViewKey(_key: Key): boolean {
    return false
  }

  /** Handle enter on the selected entry; return `true` to consume it. Copy is the fallback. */
  protected activate(_index: number): boolean {
    return false
  }

  get isOpen(): boolean {
    return this.#open
  }

  /** Repaint now, for data changes made from outside the view's own keys. */
  repaint(): void {
    if (this.#open) {
      this.render()
    }
  }

  open(): void {
    if (this.#open) {
      return
    }
    this.#open = true
    this.#offset = 0
    this.#selected = undefined
    this.#write(ENTER_ALT)
    this.#unsubscribe = this.#subscribe(() => this.#scheduleRender())
    process.stdout.on('resize', this.#onResize)
    this.render()
  }

  close(): void {
    if (!this.#open) {
      return
    }
    this.#open = false
    clearTimeout(this.#renderTimer)
    // A cleared timer that stays set would make every later repaint a no-op,
    // and the views are reopened for the life of the session.
    this.#renderTimer = undefined
    process.stdout.off('resize', this.#onResize)
    this.#unsubscribe?.()
    this.#write(LEAVE_ALT)
    this.#onClose()
  }

  handleKey(key: Key): void {
    if (this.#searching) {
      return this.#handleSearchKey(key)
    }
    if (key.sequence === '/') {
      this.#searching = true
      return this.render()
    }

    const page = Math.max(1, this.bodyRows() - 1)
    switch (key.name) {
      case 'q':
      case 'escape':
        return this.close()
      case 'up':
      case 'k':
        this.#move(-1)
        break
      case 'down':
      case 'j':
        this.#move(1)
        break
      case 'pageup':
        this.#move(-page)
        break
      case 'pagedown':
        this.#move(page)
        break
      case 'g':
        if (key.sequence === 'G') {
          this.#selected = undefined
          this.#offset = 0
        }
        else {
          this.#selected = 0
        }
        break
      case 'return':
        if (this.#selected !== undefined && this.activate(this.#selected)) {
          break
        }
        void this.#copySelected()
        return
      case 'y':
        void this.#copySelected()
        return
      default:
        if (key.name && this.closeKeys.includes(key.name)) {
          return this.close()
        }
        if (!this.handleViewKey(key)) {
          return
        }
    }
    this.render()
  }

  /** Rows available for content, once the title, rule and hints are taken. */
  protected bodyRows(): number {
    return Math.max(1, (process.stdout.rows || 24) - 3)
  }

  /** The scroll position for a title line, or an empty string at the tail. */
  protected renderPosition(): string {
    return this.#offset > 0 ? ` \u00B7 ${paint('warning', `scrolled \u2191${this.#offset}`)}` : ''
  }

  /** The active search text, lowercased. Empty when nothing is being searched. */
  protected get query(): string {
    return this.#query.toLowerCase()
  }

  /** The search box, or an empty string when no search is active. */
  protected renderSearch(): string {
    if (!this.#searching && !this.#query) {
      return ''
    }
    const caret = this.#searching ? styleText('inverse', ' ') : ''
    return ` · ${styleText(MUTED, 'search')} ${styleText('bold', this.#query)}${caret}`
  }

  #handleSearchKey(key: Key): void {
    if (key.name === 'escape') {
      this.#searching = false
      this.#query = ''
    }
    else if (key.name === 'return') {
      this.#searching = false
    }
    else if (key.name === 'backspace') {
      this.#query = this.#query.slice(0, -1)
    }
    else if (key.sequence && key.sequence.length === 1 && !key.ctrl && key.sequence >= ' ') {
      this.#query += key.sequence
    }
    else {
      return
    }
    this.resetScroll()
    this.render()
  }

  protected resetScroll(): void {
    this.#offset = 0
  }

  /** Drop the selection, for views that swap their entry list wholesale. */
  protected resetSelection(): void {
    this.#selected = undefined
  }

  /** Move the selection to `index`; rendering scrolls it into view. */
  protected select(index: number): void {
    this.#selected = index
  }

  protected render(): void {
    const columns = process.stdout.columns || 80
    const bodyRows = this.bodyRows()

    const entries = this.#entries()
    if (this.#selected !== undefined) {
      this.#selected = entries.length ? Math.min(this.#selected, entries.length - 1) : undefined
    }

    const rows: string[] = []
    let selectedRows: { start: number, end: number } | undefined
    for (const [index, entry] of entries.entries()) {
      const selected = index === this.#selected
      if (selected) {
        selectedRows = { start: rows.length, end: rows.length + entry.lines.length }
      }
      for (const line of entry.lines) {
        rows.push(`${selected ? styleText('green', SELECTED_GUTTER) : GUTTER}${line}`)
      }
    }

    const maxOffset = Math.max(0, rows.length - bodyRows)
    this.#offset = Math.min(this.#offset, maxOffset)
    let end = rows.length - this.#offset
    // Keep the selection on screen, scrolling the least needed to do so.
    if (selectedRows) {
      end = Math.max(end, selectedRows.end)
      end = Math.min(end, Math.max(selectedRows.start + bodyRows, bodyRows))
      end = Math.min(end, rows.length)
      this.#offset = rows.length - end
    }
    const visible = rows.slice(Math.max(0, end - bodyRows), end)

    const frame = [
      truncate(this.renderTitle(columns), columns),
      styleText(MUTED, '─'.repeat(Math.max(0, columns))),
      ...visible,
      ...Array.from({ length: bodyRows - visible.length }).fill('') as string[],
      this.#hintLine(),
    ]
    this.#write(`\u001B[H\u001B[2J${frame.join('\n')}`)
  }

  #hintLine(): string {
    if (this.#notice && this.#notice.until > Date.now()) {
      return styleText('green', this.#notice.text)
    }
    // Typing captures every key, so the way out has to be on screen.
    const columns = process.stdout.columns || 80
    return this.#searching
      ? formatHints([['enter', 'apply'], ['esc', 'cancel'], ['⌫', 'delete']], columns)
      : this.renderHints(columns)
  }

  /**
   * Move the selection, wrapping at both ends.
   *
   * With nothing selected, moving down starts at the top and moving up starts
   * at the bottom, so either arrow is a way in.
   */
  /** Views lay out inside the gutter, so their own truncation stays exact. */
  #entries(): OverlayEntry[] {
    return this.renderEntries((process.stdout.columns || 80) - GUTTER_WIDTH)
  }

  #move(delta: number): void {
    const total = this.#entries().length
    if (!total) {
      return
    }
    if (this.#selected === undefined) {
      this.#selected = delta > 0 ? 0 : total - 1
      return
    }
    const next = this.#selected + delta
    this.#selected = ((next % total) + total) % total
  }

  async #copySelected(): Promise<void> {
    const entries = this.#entries()
    const text = this.#selected === undefined ? undefined : entries[this.#selected]?.copy
    if (!text) {
      this.#notify('nothing selected to copy')
      return
    }
    try {
      const { writeText } = await import('tinyclip')
      // What lands on the clipboard is going into an issue or a search box,
      // so it should carry no colour or hyperlink escapes.
      await writeText(stripAnsi(text))
      this.#notify('copied to clipboard')
    }
    catch {
      this.#notify('no clipboard available')
    }
  }

  #notify(text: string): void {
    this.#notice = { text: `  ${text}`, until: Date.now() + NOTICE_MS }
    this.render()
    setTimeout(() => {
      if (this.#open) {
        this.render()
      }
    }, NOTICE_MS + 50).unref?.()
  }

  #scheduleRender(): void {
    if (!this.#open || this.#renderTimer) {
      return
    }
    this.#renderTimer = setTimeout(() => {
      this.#renderTimer = undefined
      if (this.#open) {
        this.render()
      }
    }, RENDER_DELAY_MS)
    this.#renderTimer.unref?.()
  }
}

/**
 * `key description` pairs joined the way every view's hint line is, dropped
 * from the right until they fit. The first and last are kept: moving around
 * and getting out matter more than any filter.
 */
export function formatHints(hints: Array<[key: string, description: string]>, columns = Number.POSITIVE_INFINITY): string {
  const remaining = [...hints]
  const render = () => remaining
    .map(([key, description]) => `${styleText('bold', key)} ${styleText(MUTED, description)}`)
    .join(styleText(MUTED, ' · '))

  while (remaining.length > 2 && visibleWidth(render()) > columns) {
    remaining.splice(remaining.length - 2, 1)
  }
  return render()
}
