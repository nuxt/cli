import type { DevEventLog, DevLogEvent } from './events'
import type { Key } from './keys'
import type { DevRequest, RequestLog } from './requests'

import type { OverlayEntry } from './screen'

import process from 'node:process'

import { styleText } from 'node:util'

import { link } from 'clickable-path'

import { formatEvent, formatTime } from './overlay'
import { statusColour } from './panel'
import { formatHints, ScreenOverlay } from './screen'

type TrafficFilter = 'all' | 'errors' | 'slow'

/** Requests at or above this duration are highlighted, and matched by the slow filter. */
const SLOW_MS = 100
const VERY_SLOW_MS = 500

const SCAN_LIMIT = 1000

const EVENT_SCAN_LIMIT = 10_000

/**
 * How much earlier than the request's own start a log may be and still belong
 * to it, covering clock skew between the two feeds.
 */
const TRACE_EARLY_MS = 2000

/** A live table of served requests: the server-side view a browser cannot show. */
export class RequestOverlay extends ScreenOverlay {
  #requests: RequestLog
  #events?: DevEventLog
  #filter: TrafficFilter = 'all'
  #showInternal = false
  #detail?: DevRequest
  #resolveFile: (request: DevRequest) => string | undefined
  #cwd: string

  constructor(
    requests: RequestLog,
    write: (chunk: string) => void,
    onClose: () => void,
    options: { resolveFile?: (request: DevRequest) => string | undefined, cwd?: string, events?: DevEventLog } = {},
  ) {
    super({ write, onClose, subscribe: listener => requests.onChange(listener) })
    this.#requests = requests
    this.#events = options.events
    this.#resolveFile = options.resolveFile ?? (() => undefined)
    this.#cwd = options.cwd ?? process.cwd()
  }

  protected get closeKeys(): readonly string[] {
    return ['n']
  }

  handleKey(key: Key): void {
    // Inside a trace, the ways out lead back to the table, not out of the view.
    if (this.#detail && (key.name === 'escape' || key.name === 'q' || key.name === 'backspace' || key.name === 'n')) {
      this.#detail = undefined
      this.resetSelection()
      this.resetScroll()
      return this.repaint()
    }
    super.handleKey(key)
  }

  protected activate(index: number): boolean {
    if (this.#detail) {
      return false
    }
    const request = this.#matching()[index]
    if (!request) {
      return false
    }
    this.#detail = request
    this.resetSelection()
    this.resetScroll()
    return true
  }

  protected handleViewKey(key: Key): boolean {
    if (this.#detail) {
      return false
    }
    switch (key.name) {
      case 'a':
        return this.#setFilter('all')
      case 'e':
        return this.#setFilter('errors')
      case 's':
        return this.#setFilter('slow')
      case 'b':
        this.#showInternal = !this.#showInternal
        this.resetScroll()
        return true
      default:
        return false
    }
  }

  protected renderTitle(): string {
    if (this.#detail) {
      const request = this.#detail
      const status = styleText(statusColour(request.status), String(request.status))
      return ` ${styleText('bold', 'trace')} · ${styleText('bold', `${request.method} ${request.url}`)} · ${status} · ${request.duration}ms${this.renderSearch()}`
    }
    const shown = this.#matching().length
    const label = this.#filter === 'all' ? 'all' : this.#filter
    const median = this.#requests.medianDuration()
    const summary = styleText('dim', `${this.#requests.total} total · median ${median}ms`)
    const hiddenInternal = this.#showInternal ? 0 : this.#requests.recent(SCAN_LIMIT, request => !!request.internal).length
    const bundler = hiddenInternal ? ` · ${styleText('dim', `${hiddenInternal} bundler hidden`)}` : ''
    return ` ${styleText('bold', 'traffic')} · ${label} (${shown}) · ${summary}${bundler}${this.renderPosition()}${this.renderSearch()}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    if (this.#detail) {
      return this.#renderTrace(this.#detail, columns)
    }
    const matching = this.#matching()
    if (!matching.length) {
      return [{ lines: [styleText('dim', this.#requests.total ? 'no requests match this filter' : 'waiting for requests…')] }]
    }
    const errors = this.#errorCounts()
    return matching.map(request => ({
      lines: [this.#format(request, columns, request.id === undefined ? 0 : errors.get(request.id) ?? 0)],
      copy: `${request.method} ${request.url} ${request.status} ${request.duration}ms`,
    }))
  }

  protected renderHints(columns: number): string {
    if (this.#detail) {
      return formatHints([
        ['↑/↓', 'select'],
        ['enter', 'copy'],
        ['esc', 'back'],
      ], columns)
    }
    return formatHints([
      ['↑/↓', 'select'],
      ['enter', 'trace'],
      ['g/G', 'top/bottom'],
      ['e', 'errors'],
      ['s', `slow >${SLOW_MS}ms`],
      ['a', 'all'],
      ['b', 'bundler'],
      ['/', 'search'],
      ['y', 'copy'],
      ['q', 'close'],
    ], columns)
  }

  /** The request as a heading, then every log the server attributed to it. */
  #renderTrace(request: DevRequest, columns: number): OverlayEntry[] {
    const file = this.#resolveFile(request)
    const summary: OverlayEntry[] = [
      {
        lines: [this.#format(request, columns, 0)],
        copy: `${request.method} ${request.url} ${request.status} ${request.duration}ms`,
      },
      ...file ? [{ lines: [`${' '.repeat(12)}${styleText('dim', 'served by ')}${link(file, { cwd: this.#cwd })}`], copy: file }] : [],
      { lines: [''] },
    ]
    const events = this.#traceEvents(request)
    if (!events.length) {
      return [...summary, { lines: [styleText('dim', request.id === undefined ? 'this request predates log attribution' : 'no logs were captured for this request')] }]
    }
    const timeWidth = Math.max(0, ...events.map(event => formatTime(event.time).length))
    return [...summary, ...events.map(event => ({
      lines: formatEvent(event, columns, timeWidth, true),
      copy: [formatTime(event.time), event.message].filter(Boolean).join(' '),
    }))]
  }

  #traceEvents(request: DevRequest): DevLogEvent[] {
    if (!this.#events || request.id === undefined) {
      return []
    }
    // Request ids restart with the server, so the id alone could pair a log
    // from a previous run with a request from this one; time bounds it.
    const start = request.time - request.duration - TRACE_EARLY_MS
    return this.#events.recent(EVENT_SCAN_LIMIT, event =>
      event.requestId === request.id && event.time >= start)
  }

  /** Error-log counts per request id, for the markers in the table. */
  #errorCounts(): Map<number, number> {
    const counts = new Map<number, number>()
    for (const event of this.#events?.recent(EVENT_SCAN_LIMIT, event => event.requestId !== undefined && event.level <= 0) ?? []) {
      counts.set(event.requestId!, (counts.get(event.requestId!) ?? 0) + 1)
    }
    return counts
  }

  #format(request: DevRequest, columns: number, errors: number): string {
    const file = this.#resolveFile(request)
    return formatRequest(request, columns, file ? { file, cwd: this.#cwd } : undefined, errors)
  }

  #matching(): DevRequest[] {
    const query = this.query
    return this.#requests.recent(SCAN_LIMIT, (request) => {
      if (request.internal && !this.#showInternal) {
        return false
      }
      if (query && !`${request.method} ${request.url} ${request.status}`.toLowerCase().includes(query)) {
        return false
      }
      if (this.#filter === 'errors') {
        return request.status >= 400
      }
      if (this.#filter === 'slow') {
        return request.duration >= SLOW_MS
      }
      return true
    })
  }

  #setFilter(filter: TrafficFilter): boolean {
    this.#filter = this.#filter === filter ? 'all' : filter
    this.resetScroll()
    return true
  }
}

function formatDuration(duration: number): string {
  const text = `${duration}ms`.padStart(7)
  if (duration >= VERY_SLOW_MS) {
    return styleText('red', text)
  }
  return duration >= SLOW_MS ? styleText('yellow', text) : styleText('dim', text)
}

function formatRequest(request: DevRequest, columns: number, target?: { file: string, cwd: string }, errors = 0): string {
  const time = styleText('dim', formatTime(request.time).padStart(11))
  const method = styleText('bold', request.method.padEnd(6))
  const status = styleText(statusColour(request.status), String(request.status).padEnd(4))
  const duration = formatDuration(request.duration)
  const marker = errors ? ` ${styleText(['red', 'bold'], `✗ ${errors}`)}` : ''
  // The four fixed columns above, plus the spaces between them and the marker.
  const room = Math.max(10, columns - 34 - (errors ? `  ✗ ${errors}`.length : 0))
  const label = request.url.length > room ? `${request.url.slice(0, room - 1)}…` : request.url
  const url = target ? link(target.file, { cwd: target.cwd, formatter: () => label }) : label
  return `${time} ${method} ${status} ${duration}  ${url}${marker}`
}
