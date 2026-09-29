import type { DevRequestSpan } from '../span-channel'
import type { DevEventLog, DevLogEvent } from './events'
import type { Key } from './keys'
import type { DevRequest, RequestLog } from './requests'

import type { OverlayEntry } from './screen'

import process from 'node:process'

import { styleText } from 'node:util'

import { link } from 'clickable-path'

import { MUTED, paint } from '../../utils/terminal-theme'

import { formatEvent, formatTime } from './overlay'
import { paintStatus } from './panel'
import { formatHints, ScreenOverlay } from './screen'
import { truncate } from './width'

type TrafficFilter = 'all' | 'errors' | 'slow'

/** Requests at or above this duration are highlighted, and matched by the slow filter. */
const SLOW_MS = 100
const VERY_SLOW_MS = 500

const SCAN_LIMIT = 1000

const EVENT_SCAN_LIMIT = 10_000

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
      const status = paintStatus(request.status)
      return ` ${styleText('bold', 'trace')} · ${styleText('bold', `${request.method} ${request.url}`)} · ${status} · ${request.duration}ms${this.renderSearch()}`
    }
    const shown = this.#matching().length
    const label = this.#filter === 'all' ? 'all' : this.#filter
    const median = this.#requests.medianDuration()
    const summary = styleText(MUTED, `${this.#requests.total} total · median ${median}ms`)
    const hiddenInternal = this.#showInternal ? 0 : this.#requests.recent(SCAN_LIMIT, request => !!request.internal).length
    const bundler = hiddenInternal ? ` · ${styleText(MUTED, `${hiddenInternal} bundler hidden`)}` : ''
    return ` ${styleText('bold', 'traffic')} · ${label} (${shown}) · ${summary}${bundler}${this.renderPosition()}${this.renderSearch()}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    if (this.#detail) {
      return this.#renderTrace(this.#detail, columns)
    }
    const matching = this.#matching()
    if (!matching.length) {
      return [{ lines: [styleText(MUTED, this.#requests.total ? 'no requests match this filter' : 'waiting for requests…')] }]
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
        ['y', 'copy'],
        ['Y', 'copy all'],
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
      ['Y', 'copy all'],
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
      ...file ? [{ lines: [`${' '.repeat(12)}${styleText(MUTED, 'served by ')}${link(file, { cwd: this.#cwd })}`], copy: file }] : [],
      { lines: [''] },
      ...renderTimeline(request, this.#requests.spansFor(request), columns),
    ]
    const events = this.#traceEvents(request)
    if (!events.length) {
      return [...summary, { lines: [styleText(MUTED, request.id === undefined ? 'this request predates log attribution' : 'no logs were captured for this request')] }]
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
    return this.#events.recent(EVENT_SCAN_LIMIT, event => event.requestId === request.id)
  }

  /** Error-log counts per request id, for the markers in the table. */
  #errorCounts(): Map<string, number> {
    const counts = new Map<string, number>()
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

type SpanColor = 'white' | 'red' | 'cyan' | 'green' | 'magenta' | 'blue' | 'yellow' | 'gray'

const SPAN_COLORS: Record<DevRequestSpan['kind'], SpanColor> = {
  route: 'green',
  middleware: 'green',
  fetch: 'magenta',
  hook: 'cyan',
  plugin: 'blue',
  data: 'yellow',
  render: 'white',
  island: 'white',
  compile: 'gray',
}

/** Columns taken by the kind, the duration and the gaps between them and the label and bar. */
const TIMELINE_CHROME = 22
const LABEL_MIN_WIDTH = 16
const TIMELINE_MIN_WIDTH = 10
/** How many Vite plugins and modules the compile breakdown lists. */
const TOP_PLUGINS = 8
const TOP_MODULES = 5

interface TimelineRow {
  kind: string
  label: string
  /** Disjoint intervals drawn on the row, as `[start, end]` in epoch milliseconds. */
  segments: Array<[number, number]>
  duration: number
  color: SpanColor
}

/**
 * The request and every span timed for it, as bars on one time axis spanning
 * the request. Each span is indented beneath the spans it ran inside, and the
 * server modules compiled for it are drawn as one row wherever any was
 * compiling.
 */
function renderTimeline(request: DevRequest, spans: DevRequestSpan[], columns: number): OverlayEntry[] {
  if (!spans.length) {
    return []
  }
  const origin = Math.min(request.start ?? Number.POSITIVE_INFINITY, ...spans.map(span => span.start))
  const end = Math.max(origin + request.duration, ...spans.map(span => span.start + span.duration))
  const total = Math.max(end - origin, 1)
  const requestStart = request.start ?? origin

  const compiled = spans.filter(span => span.kind === 'compile')
  const rows: TimelineRow[] = [
    { kind: 'request', label: `${request.method} ${request.url}`, segments: [[requestStart, requestStart + request.duration]], duration: request.duration, color: 'white' },
  ]
  if (compiled.length) {
    const segments = mergeIntervals(compiled.map(span => [span.start, span.start + span.duration]))
    const shared = compiled.some(span => span.shared) ? ', shared' : ''
    rows.push({
      kind: 'compile',
      label: `  ${compiled.length} ${compiled.length === 1 ? 'module' : 'modules'}${shared}`,
      segments,
      duration: segments.reduce((sum, [from, to]) => sum + to - from, 0),
      color: SPAN_COLORS.compile,
    })
  }
  const open: DevRequestSpan[] = []
  for (const span of spans) {
    if (span.kind === 'compile') {
      continue
    }
    const spanEnd = span.start + span.duration
    while (open.length && open.at(-1)!.start + open.at(-1)!.duration < spanEnd) {
      open.pop()
    }
    rows.push({
      kind: span.kind,
      label: `${'  '.repeat(open.length + 1)}${span.name}${span.status ? ` ${span.status}` : ''}`,
      segments: [[span.start, spanEnd]],
      duration: span.duration,
      color: span.error || (span.status ?? 0) >= 400 ? 'red' : SPAN_COLORS[span.kind] ?? 'white',
    })
    open.push(span)
  }

  const longest = Math.max(...rows.map(row => row.label.length))
  const labelWidth = Math.max(LABEL_MIN_WIDTH, Math.min(longest, Math.floor(columns * 0.4)))
  const width = Math.max(TIMELINE_MIN_WIDTH, columns - labelWidth - TIMELINE_CHROME)
  const totalLabel = formatSpanDuration(total)
  const axis = styleText(MUTED, `${'0ms'.padEnd(width - totalLabel.length)}${totalLabel}`)

  return [
    { lines: [`${styleText('bold', 'timeline'.padEnd(labelWidth + 11))} ${axis}`] },
    ...rows.map((row) => {
      const label = truncate(row.label, labelWidth).padEnd(labelWidth)
      const time = formatSpanDuration(row.duration).padStart(9)
      return {
        lines: [`${styleText(MUTED, row.kind.padEnd(10))} ${label} ${drawBar(row, origin, total, width)} ${styleText(MUTED, time)}`],
        copy: `+${formatSpanDuration(row.segments[0]![0] - origin)} ${row.kind} ${row.label.trim()} ${formatSpanDuration(row.duration)}`,
      }
    }),
    { lines: [''] },
    ...renderCompileBreakdown(compiled, columns),
  ]
}

function drawBar(row: TimelineRow, origin: number, total: number, width: number): string {
  const cells = Array.from<boolean>({ length: width }).fill(false)
  for (const [from, to] of row.segments) {
    const offset = Math.min(width - 1, Math.floor((from - origin) / total * width))
    const length = Math.max(1, Math.min(width - offset, Math.round((to - from) / total * width)))
    cells.fill(true, offset, offset + length)
  }
  return cells
    .map(filled => filled ? '█' : ' ')
    .join('')
    .replace(/█+/g, run => styleText(row.color, run))
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = []
  for (const [from, to] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && from <= last[1]) {
      last[1] = Math.max(last[1], to)
    }
    else {
      merged.push([from, to])
    }
  }
  return merged
}

/** Where the compile time went: the busiest Vite plugins, then the slowest modules. */
function renderCompileBreakdown(compiled: DevRequestSpan[], columns: number): OverlayEntry[] {
  if (!compiled.length) {
    return []
  }
  const byPlugin = new Map<string, number>()
  for (const span of compiled) {
    for (const [plugin, time] of Object.entries(span.plugins ?? {})) {
      byPlugin.set(plugin, (byPlugin.get(plugin) ?? 0) + time)
    }
  }
  const plugins = [...byPlugin].sort((a, b) => b[1] - a[1]).slice(0, TOP_PLUGINS)
  const modules = [...compiled].sort((a, b) => b.duration - a.duration).slice(0, TOP_MODULES)
  const nameWidth = Math.max(0, columns - 12)
  const row = (name: string, duration: number): OverlayEntry => ({
    lines: [`  ${formatSpanDuration(duration).padStart(8)}  ${truncate(name, nameWidth)}`],
    copy: `${formatSpanDuration(duration)} ${name}`,
  })
  return [
    ...plugins.length
      ? [
          { lines: [styleText('bold', 'vite plugins') + styleText(MUTED, ' · time spent compiling for this request')] },
          ...plugins.map(([plugin, time]) => row(plugin, time)),
          { lines: [''] },
        ]
      : [],
    { lines: [styleText('bold', 'slowest modules')] },
    ...modules.map(span => row(span.environment ? `${span.name} ${styleText(MUTED, `(${span.environment})`)}` : span.name, span.duration)),
    { lines: [''] },
  ]
}

function formatSpanDuration(duration: number): string {
  return duration < 10 ? `${Math.max(0, duration).toFixed(1)}ms` : `${Math.round(duration)}ms`
}

function formatDuration(duration: number): string {
  const text = `${duration}ms`.padStart(7)
  if (duration >= VERY_SLOW_MS) {
    return styleText('red', text)
  }
  return duration >= SLOW_MS ? paint('warning', text) : styleText(MUTED, text)
}

function formatRequest(request: DevRequest, columns: number, target?: { file: string, cwd: string }, errors = 0): string {
  const time = styleText(MUTED, formatTime(request.time).padStart(11))
  const method = styleText('bold', request.method.padEnd(6))
  const status = paintStatus(request.status, String(request.status).padEnd(4))
  const duration = formatDuration(request.duration)
  const marker = errors ? ` ${styleText(['red', 'bold'], `✗ ${errors}`)}` : ''
  // The four fixed columns above, plus the spaces between them and the marker.
  const room = Math.max(10, columns - 34 - (errors ? `  ✗ ${errors}`.length : 0))
  const label = request.url.length > room ? `${request.url.slice(0, room - 1)}…` : request.url
  const url = target ? link(target.file, { cwd: target.cwd, formatter: () => label }) : label
  return `${time} ${method} ${status} ${duration}  ${url}${marker}`
}
