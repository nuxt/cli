import type { DevEventLog, DevLogEvent, DevLogSource } from './events'
import type { Key } from './keys'

import type { OverlayEntry } from './screen'

import { styleText } from 'node:util'

import { truncate } from '../../utils/formatting'

import { MUTED, paint } from '../../utils/terminal-theme'
import { formatHints, ScreenOverlay } from './screen'

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

  constructor(events: DevEventLog, write: (chunk: string) => void, onClose: () => void) {
    super({ write, onClose, subscribe: listener => events.onEvent(listener) })
    this.#events = events
  }

  protected get closeKeys(): readonly string[] {
    return ['l']
  }

  /** Open with the newest error selected. */
  openAtLastError(): void {
    this.open()
    const index = this.#matching().findLastIndex(event => event.level <= 0)
    if (index >= 0) {
      this.select(index)
      this.repaint()
    }
  }

  protected handleViewKey(key: Key): boolean {
    switch (key.name) {
      case 'a':
        return this.#setLevel('all')
      case 'w':
        return this.#setLevel('warn')
      case 'e':
        return this.#setLevel('error')
      case 't':
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
    const sources = (['cli', 'build', 'runtime'] as const)
      .map(source => this.#sources[source] ? styleText('bold', source) : styleText([MUTED, 'strikethrough'], source))
      .join(styleText(MUTED, '+'))
    const level = this.#level === 'all' ? 'all levels' : `${this.#level}+ only`
    const hidden = this.#events.recent(SCAN_LIMIT).length - this.#matching().length
    const hiddenNote = hidden > 0 ? ` · ${styleText(MUTED, `${hidden} hidden`)}` : ''
    return ` ${styleText('bold', 'logs')}${this.renderPosition()} · ${sources} · ${level}${hiddenNote}${this.renderSearch()}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    const events = this.#matching()
    let heading: string | undefined
    return events.map((event) => {
      const repeated = event.requestId !== undefined && event.requestId === heading
      heading = event.requestId
      return {
        key: event,
        lines: formatEvent(event, columns, repeated),
        copy: [formatTime(event.time), event.request, event.message].filter(Boolean).join(' '),
      }
    })
  }

  protected renderHints(columns: number): string {
    return formatHints([
      ['↑/↓', 'select'],
      ['Home/End', 'top/live'],
      ['PgUp/PgDn', 'scroll'],
      ['e', 'errors'],
      ['w', 'warnings'],
      ['a', 'all'],
      ['t/b/r', 'cli/build/runtime'],
      ['/', 'search'],
      ['x', 'delete logs'],
      ['y', 'copy'],
      ['Y', 'copy all'],
      ['q', 'close'],
    ], columns)
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
    this.#level = this.#level === level ? 'all' : level
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

/** Format log rows with timestamps and request headings. */
export function formatEvent(event: DevLogEvent, columns: number, sameRequest = false): string[] {
  const messageColumn = 9
  const date = new Date(event.time)
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
  const time = styleText(MUTED, clock)
  const tag = event.tag ? styleText(MUTED, `[${event.tag}] `) : ''
  const indent = ' '.repeat(messageColumn)

  const marker = event.repeats && event.repeats > 1 ? styleText(MUTED, ` ×${event.repeats}`) : ''
  const markerWidth = event.repeats && event.repeats > 1 ? ` ×${event.repeats}`.length : 0

  const lines = event.message
    .split('\n')
    .map((line, index) => {
      const room = Math.max(20, columns - messageColumn - 1 - (index === 0 ? markerWidth : 0))
      const text = colorBySeverity(truncate(line, room), event)
      return index === 0 ? `${text}${marker}` : text
    })

  if (event.request) {
    return [
      ...sameRequest ? [] : [`${time} ${styleText(['magenta', 'bold'], event.request)}`],
      ...lines.map(line => `${indent}${line}`),
    ]
  }

  return lines.map((line, index) => index === 0 ? `${time} ${tag}${line}` : `${indent}${line}`)
}

/** Colour a message by its level, unless it already carries its own colour. */
function colorBySeverity(line: string, event: DevLogEvent): string {
  if (event.styled || line.includes('\u001B[')) {
    return line
  }
  if (event.level <= 0) {
    return styleText('red', line)
  }
  return event.level <= 1 ? paint('warning', line) : line
}
