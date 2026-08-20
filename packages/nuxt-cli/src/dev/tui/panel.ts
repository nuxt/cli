import type { TerminalBackground } from '../../utils/terminal-theme'

import { styleText } from 'node:util'

import { renderLogo } from './logo'
import { stripAnsi, truncate, visibleWidth } from './width'

export type DevStatus = 'starting' | 'building' | 'ready' | 'restarting' | 'error'

export interface PanelURL {
  label: string
  url: string
  /** The same URL wrapped in a terminal hyperlink, where one is supported. */
  link?: string
  style?: Parameters<typeof styleText>[0]
  /** Bound but not yet confirmed against the resolved config. */
  pending?: boolean
}

export interface PanelHint {
  key: string
  label: string
  /** Higher survives longer when the line is too narrow. */
  priority: number
}

/**
 * The hint line as it reads before the controller is attached, painted dimmed
 * from the first frame so the panel never gains a line partway through
 * startup. Replaced by the live set derived from the controller's shortcuts.
 */
export const DEFAULT_HINTS: PanelHint[] = [
  { key: 'r', label: 'restart', priority: 80 },
  { key: 'o', label: 'open', priority: 40 },
  { key: 'i', label: 'info', priority: 50 },
  { key: 'l', label: 'logs', priority: 70 },
  { key: 'n', label: 'network', priority: 60 },
  { key: 'p', label: 'routes', priority: 30 },
  { key: '?', label: 'help', priority: 100 },
  { key: 'q', label: 'quit', priority: 90 },
]

export interface PanelState {
  status: DevStatus
  version?: string
  /** The running version as a link to its release notes, where supported. */
  versionLink?: string
  update?: string
  updateLink?: string
  urls?: PanelURL[]
  /** Milliseconds from process start to the first ready, once known. */
  readyMs?: number
  /** Milliseconds the current load has been running, while one is running. */
  elapsedMs?: number
  /** How far through startup the current load is, 0..1, while one is running. */
  progress?: number
  /** When the current load began, for the ticking elapsed time. */
  loadStartedAt?: number
  requests?: number
  medianMs?: number
  /** Warnings since the last successful load. */
  warnings?: number
  /** Errors since the last successful load. */
  errors?: number
  /** Requests answered with a 5xx since the last successful load. */
  failures?: number
  lastRequest?: { method: string, url: string, status: number, duration: number }
  /** Advances while the mark is animating. */
  frame?: number
  /** A request was served recently, lighting the mark's trailing cell. */
  active?: boolean
  /** Replaces the badge's standing description, for a restart reason. */
  note?: string
  /** Passing feedback, shown for a moment and then dropped. */
  notice?: { text: string, tone: 'info' | 'warn' | 'success' }
  confirmQuit?: boolean
  /** Shortcut hints, dropped lowest-priority first when the line is full. */
  hints?: PanelHint[]
  /** The keys are not being listened for yet, so the hints render greyed out. */
  hintsDimmed?: boolean
  /** Substitute plain characters for the box-drawing and braille glyphs. */
  ascii?: boolean
  background?: TerminalBackground
}

interface Badge {
  label: string
  style: Parameters<typeof styleText>[0]
  note: string
}

const BADGES: Record<DevStatus, Badge> = {
  starting: { label: 'STARTING', style: ['bgYellow', 'black', 'bold'], note: 'preparing your app' },
  building: { label: 'BUILDING', style: ['bgYellow', 'black', 'bold'], note: 'compiling changes' },
  restarting: { label: 'RESTART', style: ['bgYellow', 'black', 'bold'], note: 'reloading the dev server' },
  error: { label: 'ERROR', style: ['bgRed', 'white', 'bold'], note: 'an error was logged · press e to view it' },
  ready: { label: 'READY', style: ['bgGreen', 'black', 'bold'], note: 'watching for changes' },
}

const SEPARATOR = styleText('dim', ' \u00B7 ')

/** Blocks are dropped from the least important until the panel fits. */
const BLOCK_PRIORITY = ['hints', 'status', 'wordmark', 'urls', 'summary', 'space'] as const

type BlockName = typeof BLOCK_PRIORITY[number]

interface Block {
  name: BlockName
  lines: string[]
}

/**
 * The pinned dev server panel, as lines without a trailing newline.
 *
 * Pure, so it can be re-rendered on resize without touching terminal state.
 * Content is assembled as blocks and the least important are dropped until the
 * result fits `rows`, so the same layout serves a full screen and a split pane.
 */
export function renderPanel(state: PanelState, columns: number, rows = 24): string[] {
  const width = Math.max(1, columns)
  const blocks = ([
    { name: 'wordmark', lines: [renderWordmark(state, width)] },
    { name: 'space', lines: [''] },
    { name: 'urls', lines: renderURLs(state, width) },
    { name: 'space', lines: [''] },
    { name: 'summary', lines: renderSummary(state, width) },
    { name: 'space', lines: [''] },
    { name: 'status', lines: [renderStatus(state, width)] },
    { name: 'hints', lines: [renderHints(state, width)] },
  ] satisfies Block[]).filter(block => block.lines.length > 0)

  const budget = Math.max(2, Math.min(rows - 1, 14))
  const dropped = new Set<Block>()
  // Blank lines are spacing, so they collapse wherever the block they
  // separated is empty or has been shed.
  const layout = () => blocks
    .filter(block => !dropped.has(block))
    .flatMap(block => block.lines)
    .filter((line, index, lines) => line !== '' || (index > 0 && index < lines.length - 1 && lines[index - 1] !== ''))

  for (const name of BLOCK_PRIORITY.toReversed()) {
    if (layout().length <= budget) {
      break
    }
    for (const block of blocks) {
      if (block.name === name) {
        dropped.add(block)
      }
    }
  }

  return layout()
}

function renderWordmark(state: PanelState, columns: number): string {
  const mark = state.ascii
    ? styleText('green', '>')
    : renderLogo({ working: state.status !== 'ready' && state.status !== 'error', frame: state.frame, active: state.active, background: state.background })
  const version = state.versionLink ?? state.version
  const head = ` ${mark}  ${styleText(['green', 'bold'], 'Nuxt')}${version ? ` ${styleText('dim', version)}` : ''}${
    state.update ? styleText('yellow', `  ${state.updateLink ?? `\u2192 ${state.update}`}`) : ''}`

  const tail = state.readyMs === undefined
    ? ''
    : styleText('dim', `ready in ${formatDuration(state.readyMs)} `)
  const gap = columns - visibleWidth(head) - visibleWidth(tail)
  return gap < 2 ? truncate(head, columns) : head + ' '.repeat(gap) + tail
}

/** The spinner shown next to a URL that is bound but not yet confirmed. */
const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'] as const

function renderURLs(state: PanelState, columns: number): string[] {
  const urls = state.urls?.filter(entry => !!entry.url) ?? []
  if (!urls.length) {
    return []
  }
  const width = Math.max(...urls.map(entry => entry.label.length))
  return urls.map(({ label, url, link, style, pending }) => {
    const spinner = pending
      ? ` ${styleText('yellow', state.ascii ? '~' : SPINNER_FRAMES[(state.frame ?? 0) % SPINNER_FRAMES.length]!)}`
      : ''
    return truncate(
      `   ${styleText('dim', label.padEnd(width))}   ${styleText(pending ? 'dim' : style ?? 'cyan', link ?? url)}${spinner}`,
      columns,
    )
  })
}

const PROGRESS_BAR_WIDTH = 20

function renderProgress(state: PanelState, columns: number): string {
  const fraction = Math.min(1, Math.max(0, state.progress ?? 0))
  const filled = Math.round(fraction * PROGRESS_BAR_WIDTH)
  const glyph = state.ascii ? '=' : '\u2501'
  const bar = styleText('green', glyph.repeat(filled)) + styleText('dim', glyph.repeat(PROGRESS_BAR_WIDTH - filled))
  const elapsed = state.elapsedMs === undefined ? '' : `${SEPARATOR}${styleText('dim', `${(state.elapsedMs / 1000).toFixed(1)}s`)}`
  return truncate(`   ${bar} ${styleText('dim', `${Math.round(fraction * 100)}%`)}${elapsed}`, columns)
}

function renderSummary(state: PanelState, columns: number): string[] {
  const marks = state.ascii
    ? { ok: '+', warn: '!', fail: 'x' }
    : { ok: '\u2714', warn: '\u26A0', fail: '\u2716' }

  if (state.status !== 'ready' && state.status !== 'error' && state.progress !== undefined) {
    return [renderProgress(state, columns)]
  }

  const parts: string[] = []
  if (state.requests) {
    parts.push(styleText('green', `${marks.ok} ${state.requests} ${plural(state.requests, 'request')}`))
  }
  if (state.medianMs !== undefined && state.requests) {
    parts.push(styleText('dim', `${state.medianMs}ms median`))
  }
  if (state.warnings) {
    parts.push(styleText('yellow', `${marks.warn} ${state.warnings} ${plural(state.warnings, 'warning')}`))
  }
  if (state.errors) {
    parts.push(styleText(['red', 'bold'], `${marks.fail} ${state.errors} ${plural(state.errors, 'error')}`))
  }
  if (state.failures) {
    parts.push(styleText(['red', 'bold'], `${marks.fail} ${state.failures} failed ${plural(state.failures, 'request')}`))
  }
  if (!parts.length) {
    // The line stays reserved so the first request cannot reflow the panel.
    return [truncate(`   ${styleText('dim', 'waiting for requests')}`, columns)]
  }
  return [truncate(`   ${parts.join(styleText('dim', '   '))}`, columns)]
}

/**
 * Status notes read as small lowercase phrases, but several arrive as
 * sentences ("Restarting Nuxt...", the progress phases). Only a leading
 * capital followed by lowercase is folded, so acronyms survive.
 */
function decapitalise(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text
}

const NOTICE_TONES = {
  info: { mark: { unicode: '\u2139', ascii: 'i' }, style: 'cyan' },
  warn: { mark: { unicode: '\u26A0', ascii: '!' }, style: 'yellow' },
  success: { mark: { unicode: '\u2714', ascii: '+' }, style: 'green' },
} as const satisfies Record<string, { mark: { unicode: string, ascii: string }, style: Parameters<typeof styleText>[0] }>

/** Passing feedback, in place of the badge's standing description. */
function renderNotice(state: PanelState): string {
  const { mark, style } = NOTICE_TONES[state.notice!.tone]
  const glyph = state.ascii ? mark.ascii : mark.unicode
  return `${styleText(style, glyph)} ${styleText('dim', decapitalise(state.notice!.text))}`
}

function renderStatus(state: PanelState, columns: number): string {
  if (state.confirmQuit) {
    return truncate(
      ` ${styleText(['bgYellow', 'black', 'bold'], ' QUIT? ')}  ${styleText('dim', 'press')} ${styleText('bold', 'y')} ${styleText('dim', 'to confirm,')} ${styleText('bold', 'esc')} ${styleText('dim', 'to stay')}`,
      columns,
    )
  }

  const badge = BADGES[state.status]
  const description = state.notice ? renderNotice(state) : styleText('dim', decapitalise(state.note || badge.note))
  const head = ` ${styleText(badge.style, ` ${badge.label} `)}  ${description}`
  return truncate(head + renderTicker(state, columns - visibleWidth(head)), columns)
}

/**
 * The most recent request, appended to the status line. Returns nothing until
 * a request arrives, or when there is no room left on the line.
 */
function renderTicker(state: PanelState, room: number): string {
  const request = state.lastRequest
  if (!request) {
    return ''
  }

  const head = `${SEPARATOR}${styleText('bold', request.method)} `
  const tail = `${SEPARATOR}${styleText(statusColour(request.status), String(request.status))}${SEPARATOR}${styleText('dim', `${request.duration}ms`)}`
  const available = room - visibleWidth(head) - visibleWidth(tail)
  if (available < 8) {
    return ''
  }
  return `${head}${truncate(request.url, available)}${tail}`
}

/**
 * Join the hints into one line that never wraps.
 *
 * The least important are dropped until the line fits. Once nothing else can
 * go, only help is left: the rest of the keys are listed there anyway.
 */
function renderHints(state: PanelState, columns: number): string {
  if (state.confirmQuit) {
    return ''
  }
  const remaining = [
    // Whatever else has to go, the way to read the error stays on screen.
    ...state.errors ? [{ key: 'e', label: 'last error', priority: Number.POSITIVE_INFINITY }] : [],
    ...state.hints ?? [],
  ]
  const render = (items: PanelHint[]) => ` ${items
    .map(({ key, label }) => `${styleText(state.hintsDimmed ? 'dim' : 'bold', key)} ${styleText('dim', label)}`)
    .join(SEPARATOR)}`

  while (remaining.length > 1 && visibleWidth(render(remaining)) > columns) {
    const weakest = remaining.reduce((lowest, item) => item.priority < lowest.priority ? item : lowest)
    remaining.splice(remaining.indexOf(weakest), 1)
  }
  return truncate(render(remaining), columns)
}

/** Response status colour, shared by the ticker and the traffic view. */
export function statusColour(status: number): Parameters<typeof styleText>[0] {
  if (status >= 500) {
    return 'red'
  }
  if (status >= 400) {
    return 'yellow'
  }
  if (status >= 300) {
    return 'cyan'
  }
  return 'green'
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

/** The panel as plain text, for asserting layout without styling. */
export function renderPanelText(state: PanelState, columns: number, rows?: number): string {
  return renderPanel(state, columns, rows).map(line => stripAnsi(line).trimEnd()).join('\n')
}
