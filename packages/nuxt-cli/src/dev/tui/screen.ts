import type { Key } from './keys'
import type { MouseReport } from './terminal-replies'

import process from 'node:process'
import { styleText } from 'node:util'

import { writeClipboard } from '../../utils/clipboard'
import { stripAnsi, truncate, visibleWidth } from '../../utils/formatting'
import { MUTED, paint } from '../../utils/terminal-theme'

import { DISABLE_MOUSE, ENABLE_MOUSE, LEFT_BUTTON, WHEEL_DOWN, WHEEL_UP } from './terminal-replies'

const RENDER_DELAY_MS = 50

const NOTICE_MS = 2000

const COPY_ALL_MAX_CHARS = 60_000

const SELECTED_GUTTER = '▎ '
const GUTTER = '  '
const GUTTER_WIDTH = 2

export interface OverlayEntry {
  lines: string[]
  /** Lines shown in place of `lines` while the entry is selected. */
  expand?: () => string[]
  /** Stable entry identity. */
  key?: object | string
  /** Plain text put on the clipboard when this entry is copied. */
  copy?: string
}

/** A key and what it does, as shown on the hint line. */
export type OverlayHint = [key: string, description: string, options?: {
  /** The filter or view in effect, highlighted and never dropped for room. */
  active?: boolean
  /** A click asks for a second one before pressing the key. */
  confirm?: boolean
}]

/** A view reachable from every other one through the row of tabs. */
export interface ViewTab {
  label: string
  view: ScreenOverlay
}

/** The columns a hint occupies on its line, end exclusive. */
interface HintSpan {
  hint: OverlayHint
  start: number
  end: number
}

// The mouse is claimed for as long as the alternate screen is, which has no
// scrollback for the terminal's own wheel to move through.
const ENTER_ALT = `\u001B[?1049h\u001B[?25l${ENABLE_MOUSE}`
const LEAVE_ALT = `${DISABLE_MOUSE}\u001B[?25h\u001B[?1049l`

const HINT_SEPARATOR = ' · '

const SEARCH_HINTS: OverlayHint[] = [
  ['enter', 'apply'],
  ['esc', 'cancel'],
  ['⌫', 'delete'],
]

/** Hint labels that are words rather than the key itself. */
const HINT_KEYS: Record<string, Key> = {
  'esc': { name: 'escape' },
  'esc/q': { name: 'escape' },
  'enter': { name: 'return' },
  '⌫': { name: 'backspace' },
}

/** Alternate-screen view with navigation, search and copying. */
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
  #tabs: readonly ViewTab[] = []
  #wheelRender?: NodeJS.Immediate
  /** A hint clicked once that needs a second click, on the hint line, to fire. */
  #confirming?: { key: Key, until: number }
  // What was last painted, so a click hits what was seen.
  #shownTabs: Array<{ view: ScreenOverlay, start: number, end: number }> = []
  #shownHints: HintSpan[] = []
  #shownEntries: Array<{ key?: object | string, index: number }> = []

  constructor(options: {
    write: (chunk: string) => void
    /** The view is no longer shown: it was closed, or another tab took its place. */
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
  protected abstract hints(): OverlayHint[]
  /** Keys that close the view, alongside `q` and `escape`, and open it from another tab. */
  protected abstract get closeKeys(): readonly string[]

  /** Handle a view-specific key; return `true` if it changed anything. */
  protected handleViewKey(_key: Key): boolean {
    return false
  }

  /** Arrow and page keys scroll rows instead of moving a selection. */
  protected get scrollsByRow(): boolean {
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

  /** Show a tab for each of `tabs` above the title, this view's among them. */
  showTabs(tabs: readonly ViewTab[]): void {
    this.#tabs = tabs
  }

  /** Take the screen, or take it over from whichever tab is showing. */
  open(): void {
    if (this.#open) {
      return
    }
    const shown = this.#tabs.find(({ view }) => view.#open)?.view
    if (shown) {
      shown.#hide()
    }
    else {
      this.#write(ENTER_ALT)
    }
    this.#open = true
    this.resetScroll()
    this.resetSelection()
    this.#unsubscribe = this.#subscribe(() => this.#scheduleRender())
    process.stdout.on('resize', this.#onResize)
    this.render()
    if (shown) {
      shown.#onClose()
    }
  }

  close(): void {
    if (!this.#open) {
      return
    }
    this.#hide()
    this.#write(LEAVE_ALT)
    this.#onClose()
  }

  #hide(): void {
    this.#open = false
    this.#confirming = undefined
    clearTimeout(this.#renderTimer)
    this.#renderTimer = undefined
    clearImmediate(this.#wheelRender)
    this.#wheelRender = undefined
    process.stdout.off('resize', this.#onResize)
    this.#unsubscribe?.()
  }

  protected handleNavigationKey(_key: Key): boolean {
    return false
  }

  handleKey(key: Key): void {
    this.#takeConfirmation()
    if (key.ctrl || (key.meta && key.name !== 'escape')) {
      return
    }
    if (this.#searching) {
      return this.#handleSearchKey(key)
    }
    if (key.sequence === '/' && !this.scrollsByRow) {
      this.#searching = true
      return this.render()
    }

    if (this.handleNavigationKey(key)) {
      return
    }

    const page = Math.max(1, this.bodyRows() - 1)
    if (this.scrollsByRow && this.#handleScrollKey(key, page)) {
      return this.render()
    }
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
        void (key.sequence === 'Y'
          ? this.#copyAll()
          : this.#copySelected())
        return
      case 'tab': {
        const index = this.#tabs.findIndex(({ view }) => view === this)
        this.#tabs.at((index + (key.shift
          ? -1
          : 1)) % this.#tabs.length)?.view.open()
        return
      }
      default: {
        if (this.#opens(key)) {
          return this.close()
        }
        const tab = this.#tabs.find(({ view }) => view.#opens(key))
        if (tab) {
          return tab.view.open()
        }
        if (!this.handleViewKey(key)) {
          return
        }
      }
    }
    this.render()
  }

  /**
   * The wheel does what the arrow keys do. A click selects the entry under it;
   * a click on the selected entry is enter. A click on a tab opens its view,
   * and a click on a hint presses its key.
   */
  handleMouse({ button, pressed, row, column }: MouseReport): void {
    if (button === WHEEL_UP || button === WHEEL_DOWN) {
      if (this.#searching) {
        return
      }
      const direction = button === WHEEL_UP
        ? -1
        : 1
      if (this.scrollsByRow) {
        this.#scroll(direction)
      }
      else {
        this.#move(direction)
      }
      // One repaint for however many reports arrived together.
      this.#wheelRender ??= setImmediate(() => {
        this.#wheelRender = undefined
        this.render()
      })
      return
    }
    if (button !== LEFT_BUTTON || !pressed) {
      return
    }
    const confirmed = this.#takeConfirmation()
    const headerRows = this.#headerRows()
    if (row === headerRows + this.bodyRows()) {
      if (confirmed) {
        return this.handleKey(confirmed)
      }
      const hint = this.#shownHints.find(({ start, end }) => column >= start && column < end)?.hint
      const key = hint && hintKey(hint[0])
      if (!key) {
        return
      }
      if (hint[2]?.confirm) {
        this.#confirming = { key, until: Date.now() + NOTICE_MS }
        return this.notify(`click again to ${hint[1]}`)
      }
      return this.handleKey(key)
    }
    if (this.#searching) {
      return
    }
    if (this.#tabs.length && row === 0) {
      return this.#shownTabs.find(({ start, end }) => column >= start && column < end)?.view.open()
    }
    const shown = row >= headerRows && !this.scrollsByRow
      ? this.#shownEntries[row - headerRows]
      : undefined
    if (!shown) {
      return
    }
    // Resolved by identity: the list may have changed since it was painted.
    const index = shown.key === undefined
      ? shown.index
      : this.#entries().findIndex(entry => entry.key === shown.key)
    if (index < 0) {
      return
    }
    const again = shown.key === undefined
      ? index === this.#selected
      : shown.key === this.#selectedKey
    this.select(index)
    if (again) {
      this.handleKey({ name: 'return' })
    }
    else {
      this.render()
    }
  }

  /** Stop waiting for a second click, returning the key it would still have pressed. */
  #takeConfirmation(): Key | undefined {
    const confirming = this.#confirming
    if (!confirming) {
      return
    }
    this.#confirming = undefined
    this.#notice = undefined
    return confirming.until > Date.now()
      ? confirming.key
      : undefined
  }

  #opens(key: Key): boolean {
    return (!!key.name && this.closeKeys.includes(key.name)) || (!!key.sequence && this.closeKeys.includes(key.sequence))
  }

  /** The tabs if there are any, the title and the rule under it. */
  #headerRows(): number {
    return this.#tabs.length ? 3 : 2
  }

  #handleScrollKey(key: Key, page: number): boolean {
    switch (key.name) {
      case 'up':
      case 'k':
        this.#scroll(-1)
        return true
      case 'down':
      case 'j':
        this.#scroll(1)
        return true
      case 'pageup':
        this.#scroll(-page)
        return true
      case 'pagedown':
        this.#scroll(page)
        return true
      case 'home':
        this.#scroll(Number.NEGATIVE_INFINITY)
        return true
      case 'end':
        this.resetScroll()
        return true
      case 'g':
        if (key.sequence === 'G') {
          this.resetScroll()
        }
        else {
          this.#scroll(Number.NEGATIVE_INFINITY)
        }
        return true
      default:
        return false
    }
  }

  /** Rows available for content, once the header and hints are taken. */
  protected bodyRows(): number {
    return Math.max(1, (process.stdout.rows || 24) - this.#headerRows() - 1)
  }

  protected renderPosition(): string {
    return this.#following
      ? ''
      : ` · ${paint('warning', `follow paused${this.#offset > 0
        ? ` · ↓${this.#offset} rows below`
        : ''}`)}`
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
    const caret = this.#searching
      ? styleText('inverse', ' ')
      : ''
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
    else if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
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

  /** Stop following and show the first row. */
  protected scrollToTop(): void {
    this.#following = false
    this.#top = 0
    this.#anchor = undefined
  }

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

    let entries = this.#entries()
    if (!this.#revealSelection && this.#selectedKey !== undefined) {
      const index = entries.findIndex(entry => entry.key === this.#selectedKey)
      this.#selected = index < 0
        ? undefined
        : index
    }
    if (this.#selected !== undefined) {
      this.#selected = entries.length
        ? Math.min(this.#selected, entries.length - 1)
        : undefined
    }
    this.#selectedKey = this.#selected === undefined
      ? undefined
      : entries[this.#selected]?.key
    entries = this.#expandSelected(entries)

    const rows: string[] = []
    const rowEntries: number[] = []
    let selectedRows: { start: number, end: number } | undefined
    for (const [index, entry] of entries.entries()) {
      const selected = index === this.#selected
      if (selected) {
        selectedRows = { start: rows.length, end: rows.length + entry.lines.length }
      }
      for (const line of entry.lines) {
        rows.push(`${selected
          ? styleText('green', SELECTED_GUTTER)
          : GUTTER}${line}`)
        rowEntries.push(index)
      }
    }

    const maxTop = Math.max(0, rows.length - bodyRows)
    let top = this.#following ? maxTop : this.#top
    if (!this.#following && this.#anchor) {
      const anchor = this.#anchor
      const index = anchor.key === undefined
        ? anchor.index
        : entries.findIndex(entry => entry.key === anchor.key)
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
    this.#shownEntries = rowEntries.slice(this.#top, this.#top + bodyRows).map(index => ({ key: entries[index]!.key, index }))

    const frame = [
      ...this.#tabs.length
        ? [
            this.#tabLine(columns),
          ]
        : [],
      this.renderTitle(columns),
      styleText(MUTED, '─'.repeat(Math.max(0, columns))),
      ...visible,
      ...Array.from({ length: bodyRows - visible.length }).fill('') as string[],
      this.#hintLine(columns),
    ].map(row => truncate(row, columns))
    this.#write(`\u001B[H\u001B[2J${frame.join('\n')}`)
  }

  #tabLine(columns: number): string {
    const tabs = this.#tabs.map(({ label, view }): OverlayHint => [
      view.closeKeys[0]!,
      label,
      { active: view === this },
    ])
    const { text, spans } = layoutHints(tabs, columns - 1)
    this.#shownTabs = spans.map(({ hint, start, end }) => ({ view: this.#tabs[tabs.indexOf(hint)]!.view, start: start + 1, end: end + 1 }))
    return ` ${text}`
  }

  #hintLine(columns: number): string {
    if (this.#notice && this.#notice.until > Date.now()) {
      this.#shownHints = []
      return styleText('green', this.#notice.text)
    }
    const { text, spans } = layoutHints(this.#searching
      ? SEARCH_HINTS
      : this.hints(), columns)
    this.#shownHints = spans
    return text
  }

  #entries(): OverlayEntry[] {
    return this.renderEntries((process.stdout.columns || 80) - GUTTER_WIDTH)
  }

  /** The entries with the selected one in its expanded form. */
  #expandSelected(entries: OverlayEntry[]): OverlayEntry[] {
    const selected = this.#selected === undefined
      ? undefined
      : entries[this.#selected]
    if (!selected?.expand) {
      return entries
    }
    return entries.with(this.#selected!, {
      ...selected,
      lines: selected.expand(),
    })
  }

  #move(delta: number): void {
    const entries = this.#expandSelected(this.#entries())
    if (!entries.length) {
      return
    }
    if (this.#selected === undefined) {
      const first = this.#rowAnchor(entries, this.#top)
      this.select(delta > 0
        ? Math.min((first?.index ?? 0) + (first?.line ? 1 : 0), entries.length - 1)
        : entries.length - 1)
      return
    }
    this.select(Math.min(Math.max(this.#selected + delta, 0), entries.length - 1))
  }

  #scroll(delta: number, entries = this.#entries()): number {
    const rows = entries.reduce((total, entry) => total + entry.lines.length, 0)
    this.#following = false
    this.#top = Math.min(Math.max(0, this.#top + delta), Math.max(0, rows - this.bodyRows()))
    this.#anchor = this.#rowAnchor(entries, this.#top)
    return rows
  }

  #page(delta: number): void {
    const entries = this.#expandSelected(this.#entries())
    const rows = this.#scroll(delta, entries)
    if (this.#selected !== undefined) {
      const start = entries.slice(0, this.#selected).reduce((total, entry) => total + entry.lines.length, 0)
      const end = start + (entries[this.#selected]?.lines.length ?? 0)
      const visible = start < this.#top + this.bodyRows() && end > this.#top
      if (visible && end - start > this.bodyRows()) {
        this.#revealSelection = false
        return
      }
    }
    this.#selected = this.#rowAnchor(entries, delta < 0
      ? this.#top
      : Math.min(rows - 1, this.#top + this.bodyRows() - 1))?.index
    this.#selectedKey = this.#selected === undefined
      ? undefined
      : entries[this.#selected]?.key
    this.#revealSelection = false
  }

  #rowAnchor(entries: OverlayEntry[], row: number): { key?: object | string, index: number, line: number } | undefined {
    let start = 0
    for (const [index, entry] of entries.entries()) {
      if (row < start + entry.lines.length) {
        return {
          key: entry.key,
          index,
          line: Math.max(0, row - start),
        }
      }
      start += entry.lines.length
    }
  }

  async #copySelected(): Promise<void> {
    const entries = this.#entries()
    const text = this.#selected === undefined
      ? undefined
      : entries[this.#selected]?.copy
    if (!text) {
      this.notify('nothing selected to copy')
      return
    }
    await this.copy(text, 'copied')
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
      return this.copy(custom.slice(0, COPY_ALL_MAX_CHARS), 'copied')
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
    const kept = start === texts.length
      ? [
          texts.at(-1)!.slice(0, COPY_ALL_MAX_CHARS),
        ]
      : texts.slice(start)
    const count = kept.length === texts.length
      ? `${kept.length}`
      : `the last ${kept.length} of ${texts.length}`
    await this.copy(kept.join('\n'), `copied ${count} ${texts.length === 1
      ? 'entry'
      : 'entries'}`)
  }

  /** Put `text` on the clipboard and report `done` in the hint line. */
  protected async copy(text: string, done: string): Promise<void> {
    this.notify(await writeClipboard(stripAnsi(text), { write: this.#write })
      ? `${done} to clipboard`
      : 'no clipboard available')
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

/** The key a click on a hint presses. Hints for several keys, like `↑/↓`, have none. */
function hintKey(label: string): Key | undefined {
  return HINT_KEYS[label] ?? (label.length === 1
    ? {
        name: label.toLowerCase(),
        sequence: label,
      }
    : undefined)
}

/**
 * Lay hints out on one line, dropping from the end until they fit. The first,
 * the last and the active ones are kept.
 */
export function layoutHints(hints: OverlayHint[], columns = Number.POSITIVE_INFINITY): { text: string, spans: HintSpan[] } {
  const remaining = [...hints]
  const width = () => remaining.reduce((total, [key, description]) => total + visibleWidth(`${key} ${description}`), 0)
    + HINT_SEPARATOR.length * (remaining.length - 1)

  while (width() > columns) {
    const droppable = remaining.findLastIndex(([, , options], index) => !options?.active && index > 0 && index < remaining.length - 1)
    if (droppable < 0) {
      break
    }
    remaining.splice(droppable, 1)
  }

  let column = 0
  const spans = remaining.map((hint): HintSpan => {
    const start = column
    column += visibleWidth(`${hint[0]} ${hint[1]}`) + HINT_SEPARATOR.length
    return { hint, start, end: column - HINT_SEPARATOR.length }
  })
  const text = remaining
    .map(([key, description, options]) => options?.active
      ? styleText(['green', 'bold'], `${key} ${description}`)
      : `${styleText('bold', key)} ${styleText(MUTED, description)}`)
    .join(styleText(MUTED, HINT_SEPARATOR))
  return { text, spans }
}
