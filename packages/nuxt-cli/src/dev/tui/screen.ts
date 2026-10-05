import type { Key } from './keys'

import process from 'node:process'
import { styleText } from 'node:util'

import { stripAnsi, truncate, visibleWidth } from '../../utils/formatting'
import { MUTED, paint } from '../../utils/terminal-theme'

import { writeClipboard } from '../listen'

const RENDER_DELAY_MS = 50

/** How long a copy confirmation stays in the hint line. */
const NOTICE_MS = 2000

/** Most characters copying a whole view puts on the clipboard, keeping the newest entries. */
const COPY_ALL_MAX_CHARS = 60_000

/** Marks the selected entry; the same width is reserved on every row. */
const SELECTED_GUTTER = '▎ '
const GUTTER = '  '
const GUTTER_WIDTH = 2

export interface OverlayEntry {
  lines: string[]
  /** Stable entry identity. */
  key?: object | string
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
  #following = true
  #top = 0
  #anchor?: { key?: object | string, index: number, line: number }
  #revealSelection = false
  #renderTimer?: NodeJS.Timeout
  #unsubscribe?: () => void
  #onResize = () => this.#scheduleRender()
  #query = ''
  #searching = false
  #selected?: number
  #selectedKey?: object | string
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

  /** Text `Y` copies instead of every entry's own. */
  protected copyAllText(): Promise<string | undefined> | string | undefined {
    return undefined
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
    this.resetScroll()
    this.resetSelection()
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
        this.#page(-page)
        break
      case 'pagedown':
        this.#page(page)
        break
      case 'home':
        this.select(0)
        break
      case 'end':
        this.resetSelection()
        this.resetScroll()
        break
      case 'g':
        if (key.sequence === 'G') {
          this.resetSelection()
          this.resetScroll()
        }
        else {
          this.select(0)
        }
        break
      case 'return':
        if (this.#selected !== undefined && this.activate(this.#selected)) {
          break
        }
        void this.#copySelected()
        return
      case 'y':
        void (key.sequence === 'Y' ? this.#copyAll() : this.#copySelected())
        return
      default:
        if ((key.name && this.closeKeys.includes(key.name)) || (key.sequence && this.closeKeys.includes(key.sequence))) {
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

  /** Follow status and rows below the viewport. */
  protected renderPosition(): string {
    return this.#following ? '' : ` · ${paint('warning', `follow paused${this.#offset > 0 ? ` · ↓${this.#offset} rows below` : ''}`)}`
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
    this.resetSelection()
    this.resetScroll()
    this.render()
  }

  protected resetScroll(): void {
    this.#offset = 0
    this.#following = true
    this.#anchor = undefined
    this.#revealSelection = false
  }

  /** Drop the selection, for views that swap their entry list wholesale. */
  protected resetSelection(): void {
    this.#selected = undefined
    this.#selectedKey = undefined
  }

  /** Move the selection to `index`; rendering scrolls it into view. */
  protected select(index: number): void {
    this.#selected = index
    this.#following = false
    this.#revealSelection = true
  }

  protected render(): void {
    const columns = process.stdout.columns || 80
    const bodyRows = this.bodyRows()

    const entries = this.#entries()
    if (!this.#revealSelection && this.#selectedKey !== undefined) {
      const index = entries.findIndex(entry => entry.key === this.#selectedKey)
      this.#selected = index < 0 ? undefined : index
    }
    if (this.#selected !== undefined) {
      this.#selected = entries.length ? Math.min(this.#selected, entries.length - 1) : undefined
    }
    this.#selectedKey = this.#selected === undefined ? undefined : entries[this.#selected]?.key

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

    const maxTop = Math.max(0, rows.length - bodyRows)
    let top = this.#following ? maxTop : this.#top
    if (!this.#following && this.#anchor) {
      const anchor = this.#anchor
      const index = anchor.key === undefined ? anchor.index : entries.findIndex(entry => entry.key === anchor.key)
      top = index < 0
        ? 0
        : entries.slice(0, index).reduce((total, entry) => total + entry.lines.length, 0)
          + Math.min(anchor.line, Math.max(0, (entries[index]?.lines.length ?? 1) - 1))
    }
    if (selectedRows && this.#revealSelection) {
      if (selectedRows.end - selectedRows.start > bodyRows || selectedRows.start < top) {
        top = selectedRows.start
      }
      else if (selectedRows.end > top + bodyRows) {
        top = selectedRows.end - bodyRows
      }
    }
    this.#revealSelection = false
    this.#top = Math.min(Math.max(0, top), maxTop)
    this.#offset = Math.max(0, rows.length - this.#top - bodyRows)
    this.#anchor = this.#rowAnchor(entries, this.#top)
    const visible = rows.slice(this.#top, this.#top + bodyRows)

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
    const columns = process.stdout.columns || 80
    return this.#searching
      ? formatHints([['enter', 'apply'], ['esc', 'cancel'], ['⌫', 'delete']], columns)
      : this.renderHints(columns)
  }

  /** Views lay out inside the gutter, so their own truncation stays exact. */
  #entries(): OverlayEntry[] {
    return this.renderEntries((process.stdout.columns || 80) - GUTTER_WIDTH)
  }

  #move(delta: number): void {
    const entries = this.#entries()
    if (!entries.length) {
      return
    }
    if (this.#selected === undefined) {
      const first = this.#rowAnchor(entries, this.#top)
      this.select(delta > 0 ? Math.min((first?.index ?? 0) + (first?.line ? 1 : 0), entries.length - 1) : entries.length - 1)
      return
    }
    this.select(Math.min(Math.max(this.#selected + delta, 0), entries.length - 1))
  }

  #page(delta: number): void {
    const entries = this.#entries()
    const rows = entries.reduce((total, entry) => total + entry.lines.length, 0)
    this.#following = false
    this.#top = Math.min(Math.max(0, this.#top + delta), Math.max(0, rows - this.bodyRows()))
    this.#anchor = this.#rowAnchor(entries, this.#top)
    this.#selected = this.#rowAnchor(entries, delta < 0 ? this.#top : Math.min(rows - 1, this.#top + this.bodyRows() - 1))?.index
    this.#selectedKey = this.#selected === undefined ? undefined : entries[this.#selected]?.key
    this.#revealSelection = false
  }

  #rowAnchor(entries: OverlayEntry[], row: number): { key?: object | string, index: number, line: number } | undefined {
    let start = 0
    for (const [index, entry] of entries.entries()) {
      if (row < start + entry.lines.length) {
        return { key: entry.key, index, line: Math.max(0, row - start) }
      }
      start += entry.lines.length
    }
  }

  async #copySelected(): Promise<void> {
    const entries = this.#entries()
    const text = this.#selected === undefined ? undefined : entries[this.#selected]?.copy
    if (!text) {
      this.notify('nothing selected to copy')
      return
    }
    await this.#copy(text, 'copied')
  }

  async #copyAll(): Promise<void> {
    let custom: string | undefined
    try {
      custom = await this.copyAllText()
    }
    catch {
      this.notify('could not gather what to copy')
      return
    }
    if (custom) {
      return this.#copy(custom.slice(0, COPY_ALL_MAX_CHARS), 'copied')
    }
    const texts = this.#entries().map(entry => entry.copy).filter(text => !!text) as string[]
    if (!texts.length) {
      this.notify('nothing to copy')
      return
    }
    let length = 0
    let start = texts.length
    while (start > 0 && length + texts[start - 1]!.length + 1 <= COPY_ALL_MAX_CHARS) {
      length += texts[--start]!.length + 1
    }
    const kept = start === texts.length ? [texts.at(-1)!.slice(0, COPY_ALL_MAX_CHARS)] : texts.slice(start)
    const count = kept.length === texts.length ? `${kept.length}` : `the last ${kept.length} of ${texts.length}`
    await this.#copy(kept.join('\n'), `copied ${count} ${texts.length === 1 ? 'entry' : 'entries'}`)
  }

  async #copy(text: string, done: string): Promise<void> {
    this.notify(await writeClipboard(stripAnsi(text)) ? `${done} to clipboard` : 'no clipboard available')
  }

  /** Replace the hint line with `text` for a moment. */
  protected notify(text: string): void {
    this.#notice = { text: `  ${text}`, until: Date.now() + NOTICE_MS }
    this.repaint()
    setTimeout(() => this.repaint(), NOTICE_MS + 50).unref?.()
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
