import type { DevEventLog, DevLogEvent, DevLogSource } from './events'
import type { Key } from './keys'

import type { OverlayEntry, OverlayHint } from './screen'

import { styleText } from 'node:util'

import { stripAnsi, truncate, visibleWidth, wrapText } from '../../utils/formatting'

import { MUTED, paint } from '../../utils/terminal-theme'
import { ScreenOverlay } from './screen'

type LevelFilter = 'all' | 'warn' | 'error'

const LEVEL_THRESHOLDS: Record<LevelFilter, number> = {
  all: Number.POSITIVE_INFINITY,
  warn: 1,
  error: 0,
}

/** Rendering considers at most this many events per frame. */
const SCAN_LIMIT = 2000

/**
 * Log history with retroactive filtering by source and level, and scrollback
 * independent of the terminal's.
 */
export class LogOverlay extends ScreenOverlay {
  #events: DevEventLog
  #sources: Record<DevLogSource, boolean> = { cli: true, build: true, runtime: true }
  #level: LevelFilter = 'all'
  #detail?: DevLogEvent
  #timestamps = true

  constructor(events: DevEventLog, write: (chunk: string) => void, onClose: () => void) {
    super({
      write,
      onClose,
      subscribe: listener => events.onEvent(listener),
    })
    this.#events = events
  }

  protected get closeKeys(): readonly string[] {
    return ['l']
  }

  /** Open on the newest error in full. */
  openAtLastError(): void {
    this.#detail = undefined
    this.open()
    const error = this.#matching().findLast(event => event.level <= 0)
    if (error) {
      this.#showDetail(error)
      this.repaint()
    }
  }

  override close(): void {
    this.#detail = undefined
    super.close()
  }

  protected override get scrollsByRow(): boolean {
    return !!this.#detail
  }

  protected override activate(index: number): boolean {
    const event = this.#detail
      ? undefined
      : this.#matching()[index]
    if (!event) {
      return false
    }
    this.#showDetail(event)
    return true
  }

  protected override handleNavigationKey(key: Key): boolean {
    if (!this.#detail) {
      return false
    }
    switch (key.name) {
      case 'escape':
      case 'q':
      case 'backspace': {
        const index = this.#matching().indexOf(this.#detail)
        this.#detail = undefined
        this.resetScroll()
        this.resetSelection()
        if (index >= 0) {
          this.select(index)
        }
        break
      }
      case 'left':
      case 'right': {
        const matching = this.#matching()
        const index = matching.indexOf(this.#detail)
        const next = index < 0
          ? undefined
          : matching[index + (key.name === 'left'
            ? -1
            : 1)]
        if (!next) {
          return true
        }
        this.#showDetail(next)
        break
      }
      case 'y':
        void this.copy(copyText(this.#detail), 'copied')
        return true
      default:
        return false
    }
    this.repaint()
    return true
  }

  #showDetail(event: DevLogEvent): void {
    this.#detail = event
    this.resetSelection()
    this.resetScroll()
    this.scrollToTop()
  }

  protected handleViewKey(key: Key): boolean {
    if (this.#detail) {
      return false
    }
    switch (key.name) {
      case 'a':
        return this.#setLevel('all')
      case 'w':
        return this.#setLevel('warn')
      case 'e':
        return this.#setLevel('error')
      case 't':
        if (key.sequence === 'T') {
          this.#timestamps = !this.#timestamps
          return true
        }
        return this.#toggleSource('cli')
      case 'b':
        return this.#toggleSource('build')
      case 'r':
        return this.#toggleSource('runtime')
      case 'x':
        this.#events.clear()
        this.resetSelection()
        this.resetScroll()
        return true
      default:
        return false
    }
  }

  protected renderTitle(): string {
    if (this.#detail) {
      return this.#renderDetailTitle(this.#detail)
    }
    const sources = (['cli', 'build', 'runtime'] as const)
      .map(source => this.#sources[source]
        ? styleText('bold', source)
        : styleText([MUTED, 'strikethrough'], source))
      .join(styleText(MUTED, '+'))
    const level = this.#level === 'all'
      ? 'all levels'
      : `${this.#level}+ only`
    const hidden = this.#events.recent(SCAN_LIMIT).length - this.#matching().length
    const hiddenNote = hidden > 0
      ? ` · ${styleText(MUTED, `${hidden} hidden`)}`
      : ''
    return ` ${styleText('bold', 'logs')}${this.renderPosition()} · ${sources} · ${level}${hiddenNote}${this.renderSearch()}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    if (this.#detail) {
      return renderDetail(this.#detail, columns)
    }
    const events = this.#matching()
    let heading: string | undefined
    let shownClock: string | undefined
    return events.map((event) => {
      const repeated = event.requestId !== undefined && event.requestId === heading
      heading = event.requestId
      let timestamp: FormatEventOptions['timestamp'] = 'hidden'
      if (this.#timestamps) {
        const clock = formatClock(event.time)
        timestamp = clock === shownClock
          ? 'blank'
          : 'shown'
        if (!repeated) {
          shownClock = clock
        }
      }
      return {
        key: event,
        lines: formatEvent(event, columns, repeated, { timestamp }),
        expand: () => formatEvent(event, columns, repeated, { expanded: true, timestamp }),
        copy: copyText(event),
      }
    })
  }

  protected hints(): OverlayHint[] {
    if (this.#detail) {
      return [
        ['↑/↓', 'scroll'],
        ['←/→', 'previous/next'],
        ['y', 'copy'],
        ['esc', 'back'],
      ]
    }
    return [
      ['↑/↓', 'select'],
      ['enter', 'details'],
      ['Home/End', 'top/live'],
      ['PgUp/PgDn', 'scroll'],
      [
        'e',
        'errors',
        { active: this.#level === 'error' },
      ],
      [
        'w',
        'warnings',
        { active: this.#level === 'warn' },
      ],
      [
        'a',
        'all',
        { active: this.#level === 'all' },
      ],
      ['t/b/r', 'cli/build/runtime'],
      ['T', 'timestamps'],
      ['/', 'search'],
      [
        'x',
        'delete logs',
        { confirm: true },
      ],
      ['y', 'copy'],
      ['Y', 'copy all'],
      ['q', 'close'],
    ]
  }

  #renderDetailTitle(event: DevLogEvent): string {
    const matching = this.#matching()
    const index = matching.indexOf(event)
    const position = index < 0
      ? ''
      : ` ${styleText(MUTED, `› ${index + 1} of ${matching.length}`)}`
    const level = colorBySeverity(event.type, { ...event, styled: false })
    const parts = [
      level,
      event.source,
      formatClock(event.time),
      ...event.tag
        ? [event.tag]
        : [],
      ...event.repeats && event.repeats > 1
        ? [`×${event.repeats}`]
        : [],
    ]
    return ` ${styleText('bold', 'logs')}${position} · ${parts.join(styleText(MUTED, ' · '))}`
  }

  #matching(): DevLogEvent[] {
    const query = this.query
    return this.#events.recent(SCAN_LIMIT, event =>
      this.#sources[event.source]
      && event.level <= LEVEL_THRESHOLDS[this.#level]
      && (!query
        || event.message.toLowerCase().includes(query)
        || !!event.tag?.toLowerCase().includes(query)
        || !!event.request?.toLowerCase().includes(query)))
  }

  #setLevel(level: LevelFilter): boolean {
    this.#level = this.#level === level
      ? 'all'
      : level
    this.resetSelection()
    this.resetScroll()
    return true
  }

  #toggleSource(source: DevLogSource): boolean {
    this.#sources[source] = !this.#sources[source]
    // Hiding everything would look like a broken view rather than a filter.
    if (Object.values(this.#sources).every(shown => !shown)) {
      this.#sources[source] = true
    }
    this.resetSelection()
    this.resetScroll()
    return true
  }
}

export function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString()
}

function formatClock(time: number): string {
  const date = new Date(time)
  return [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map(part => String(part).padStart(2, '0')).join(':')
}

function copyText(event: DevLogEvent): string {
  return [
    formatTime(event.time),
    event.request,
    event.message,
  ].filter(Boolean).join(' ')
}

/** One log in full, wrapped to the view: its request, then every line of the message. */
function renderDetail(event: DevLogEvent, columns: number): OverlayEntry[] {
  const width = Math.max(1, columns - 1)
  const lines = [
    ...event.request
      ? [
          ...wrapText(event.request, width).map(line => styleText(['magenta', 'bold'], line)),
          '',
        ]
      : [],
    ...wrapText(trimBlankLines(event.format?.(width) ?? event.message), width).map(line => colorBySeverity(line, event)),
  ]
  return lines.map(line => ({
    lines: [line],
  }))
}

function trimBlankLines(message: string): string {
  const lines = message.split('\n')
  const blank = (line: string) => !stripAnsi(line).trim()
  const start = lines.findIndex(line => !blank(line))
  const end = lines.findLastIndex(line => !blank(line))
  if (start < 0) {
    return ''
  }
  const escapes = (rows: string[]) => rows.join('').replace(/\s/g, '')
  return escapes(lines.slice(0, start)) + lines.slice(start, end + 1).join('\n') + escapes(lines.slice(end + 1))
}

export interface FormatEventOptions {
  /** Show every line of the log, wrapped, rather than one row. */
  expanded?: boolean
  /** `blank` keeps the column for a time already shown on the row above. */
  timestamp?: 'shown' | 'blank' | 'hidden'
}

/**
 * Format log rows with timestamps and request headings.
 *
 * Collapsed, a log takes one row (and its request heading), ending with how
 * many more rows it has. Expanded, every line of it is shown, wrapped.
 */
export function formatEvent(event: DevLogEvent, columns: number, sameRequest = false, options: FormatEventOptions = {}): string[] {
  const timestamp = options.timestamp ?? 'shown'
  const messageColumn = timestamp !== 'hidden'
    ? 9
    : event.request ? 2 : 0
  const clock = formatClock(event.time)
  const time = timestamp === 'hidden'
    ? ''
    : timestamp === 'blank'
      ? `${' '.repeat(clock.length)} `
      : `${styleText(MUTED, clock)} `
  const budget = columns - messageColumn - 1
  const indent = ' '.repeat(messageColumn)

  const marker = event.repeats && event.repeats > 1
    ? styleText(MUTED, ` ×${event.repeats}`)
    : ''
  const markerWidth = event.repeats && event.repeats > 1
    ? ` ×${event.repeats}`.length
    : 0

  const [first = '', ...rest] = trimBlankLines(event.format?.(Math.max(1, budget)) ?? event.message).split('\n')
  const tagRoom = Math.max(Math.floor(budget / 2), budget - markerWidth - visibleWidth(first) - 1)
  let tag = event.tag && !event.request
    ? styleText(MUTED, `[${truncate(event.tag, Math.max(1, tagRoom - 2))}] `)
    : ''
  const tagWidth = visibleWidth(tag)

  const firstRoom = Math.max(1, budget - markerWidth - tagWidth)
  const head = wrapText(first, firstRoom)
  const body = rest.flatMap(line => wrapText(line, Math.max(1, budget)))

  let lines: string[]
  if (options.expanded) {
    lines = [
      ...head.map((row, index) => index === 0
        ? `${colorBySeverity(row, event)}${marker}`
        : ' '.repeat(tagWidth) + colorBySeverity(row, event)),
      ...body.map(row => colorBySeverity(row, event)),
    ]
  }
  else {
    const hidden = head.length - 1 + body.length
    let more = hidden
      ? ` +${hidden} ${hidden === 1
        ? 'line'
        : 'lines'}`
      : ''
    if (more && firstRoom - more.length < 1) {
      more = ` +${hidden}`
    }
    const shortfall = 1 - (firstRoom - more.length)
    if (shortfall > 0 && tag) {
      const room = tagWidth - shortfall - 3
      tag = room >= 1
        ? styleText(MUTED, `[${truncate(event.tag!, room)}] `)
        : ''
    }
    const textRoom = Math.max(1, budget - markerWidth - visibleWidth(tag) - more.length)
    const text = colorBySeverity(truncate(first, textRoom), event)
    lines = [`${text}${more
      ? styleText(MUTED, more)
      : ''}${marker}`]
  }

  if (event.request) {
    return [
      ...sameRequest
        ? []
        : [`${time}${styleText(['magenta', 'bold'], event.request)}`],
      ...lines.map(line => `${indent}${line}`),
    ]
  }

  return lines.map((line, index) => index === 0
    ? `${time}${tag}${line}`
    : `${indent}${line}`)
}

/** Colour a message by its level, unless it already carries its own colour. */
function colorBySeverity(line: string, event: DevLogEvent): string {
  if (event.styled || line.includes('\u001B[')) {
    return line
  }
  if (event.level <= 0) {
    return styleText('red', line)
  }
  return event.level <= 1
    ? paint('warning', line)
    : line
}
