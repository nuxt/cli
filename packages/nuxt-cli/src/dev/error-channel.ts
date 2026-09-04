import type { CompileErrorInput, ErrorReport } from 'my-bad'
import type { BuildProgress, Channel } from 'my-bad/channel'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ProgressSnapshot } from '../utils/progress-snapshot'

import { existsSync } from 'node:fs'

import process from 'node:process'

import { BroadcastChannel } from 'node:worker_threads'

import { isAbsolute, join, normalize, relative } from 'pathe'

import { debug } from '../utils/logger'
import { DEV_INTERNAL_PREFIX } from './progress'

/** Base path of the live error channel, before `nuxt.config` is known. */
export const DEFAULT_ERROR_CHANNEL: string = `${DEV_INTERNAL_PREFIX}error`

/** Where the app reads the path the CLI mounted the channel on. */
export const ERROR_CHANNEL_ENV = 'NUXT_DEV_ERROR_CHANNEL'

/** Where the app forwards its reports when the CLI owns the channel. */
export const ERROR_BROADCAST_CHANNEL = 'nuxt:dev:error'

/** Reports the app forwards; anything else on the wire is ignored. */
export type DevErrorMessage
  = | { type: 'nuxt:dev:error:report', report: ErrorReport, requestId?: number, request?: string }
    | { type: 'nuxt:dev:error:clear', id?: string }
    | { type: 'nuxt:dev:error:warning', report: ErrorReport }

/** Asks whoever holds a current report to post it again. */
const SYNC_MESSAGE = { type: 'nuxt:dev:error:sync' } as const

const THREAD_RUNNERS = new Set(['node-worker'])

/**
 * Whether `runner` (unset means Nitro's default) evaluates the app in a thread
 * of this process, and so can reach the bridge. Anywhere else the app serves
 * the channel itself.
 */
export function isThreadRunner(runner: string | undefined): boolean {
  return !runner || THREAD_RUNNERS.has(runner)
}

let channel: Promise<Channel> | undefined

export interface ErrorChannelOptions {
  cwd?: string
  /** Directory `errors.jsonl` is written to when a sink is asked for. */
  buildDir?: string
}

/**
 * The live error channel, created on first use. Owned by the process that owns
 * the listener, so it outlives the app being rebuilt, crashing or not having
 * started.
 */
export function useErrorChannel(options: ErrorChannelOptions = {}): Promise<Channel> {
  if (!channel) {
    const pending = channel = import('my-bad/channel').then(async ({ createChannel }) => createChannel({
      open: true,
      sink: await resolveSink(options),
    }))
    // A channel that failed to open is not cached, or every later error would
    // be answered with the same rejection.
    pending.catch(() => {
      if (channel === pending) {
        channel = undefined
      }
    })
  }
  return channel
}

/** Record every channel event as JSON lines, when `NUXT_DEV_ERROR_LOG` asks for it. */
async function resolveSink(options: ErrorChannelOptions) {
  const requested = process.env.NUXT_DEV_ERROR_LOG
  if (!requested) {
    return undefined
  }
  const path = requested === '1' || requested === 'true'
    ? join(options.buildDir || join(options.cwd || process.cwd(), '.nuxt'), 'errors.jsonl')
    : requested
  const { fileSink } = await import('my-bad/sinks')
  return fileSink(path)
}

/**
 * The channel path a config asks for, or nothing when it cannot be served
 * there: a bare or trailing slash would intercept the app's own routes.
 */
export function resolveChannelPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const path = value.replace(/\/+$/, '')
  return path.startsWith('/') && path.length > 1 ? path : undefined
}

/** Whether `path` is served by the channel mounted at `base`. */
export function isErrorChannelRequest(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/** Answer a request under the mounted channel path. */
export async function handleErrorChannelRequest(req: IncomingMessage, res: ServerResponse, options: ErrorChannelOptions = {}): Promise<void> {
  const instance = await useErrorChannel(options)
  if (await instance.handler(req, res)) {
    return
  }
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end('{}')
}

export interface CreateReportOptions {
  cwd?: string
  /** Request the error was raised for, shown as the report's request section. */
  req?: IncomingMessage
}

/** A position quoted at the end of a message, as `file:line:column`. */
const TRAILING_POSITION_RE = /^\s*(?<file>(?:[a-z]:)?[^\s:][^:]*):(?<line>\d+):(?<column>\d+)[\s)]*$/i

/** A parser or loader that names itself before its message. */
const ERROR_NAME_RE = /^(?<name>[A-Z][A-Za-z]*(?:Error|Exception)): (?<message>[\s\S]*)$/

/**
 * Recast a syntax error as a compile error, so the report shows the source it
 * failed on. A parser reports a position in its message rather than its stack,
 * which points at the parser.
 */
export function toCompileInput(error: unknown): CompileErrorInput | undefined {
  if (!(error instanceof Error) || !error.message.includes('\n')) {
    return undefined
  }
  const lines = error.message.split('\n')
  const position = TRAILING_POSITION_RE.exec(lines.at(-1)!)
  // Forward slashes, since a report's snippet is only read for a path it
  // recognises and a Windows path with backslashes is not one.
  const file = position?.groups?.file && normalize(position.groups.file)
  if (!file || !isAbsolute(file) || !existsSync(file)) {
    return undefined
  }
  const described = lines.slice(0, -1).join('\n').trim()
  const named = ERROR_NAME_RE.exec(described)
  return {
    name: named?.groups?.name ?? error.name,
    message: named?.groups?.message?.trim() ?? described,
    id: file,
    loc: { file, line: Number(position.groups!.line), column: Number(position.groups!.column) },
    stack: error.stack,
  } as CompileErrorInput
}

/**
 * Build a report for something the CLI itself failed at: the config, a module's
 * setup, a build. Frames are mapped from disk; the app holds the sourcemaps of
 * its own bundle and maps its own.
 */
export async function createCliReport(error: unknown, options: CreateReportOptions = {}): Promise<ErrorReport> {
  const [{ createReport, fsLoader }, { nuxtPreset }] = await Promise.all([
    import('my-bad'),
    import('my-bad/presets'),
  ])
  return createReport(toCompileInput(error) ?? error, {
    cwd: options.cwd || process.cwd(),
    loaders: [fsLoader()],
    presets: [nuxtPreset()],
    context: options.req ? { req: options.req } : undefined,
  })
}

/** Above the bar the label sits in the header row, between brand and actions. */
const PROGRESS_LABEL_CSS = '.mb-progress-label { top: calc(100% + 6px); bottom: auto; }'

/** Render `report` as a standalone page, subscribed to the live channel. */
export async function renderErrorPage(report: ErrorReport, options: { cwd?: string, channel?: string, history?: Channel['history'] }): Promise<string> {
  const [{ renderPage }, { nuxtTheme }] = await Promise.all([
    import('my-bad'),
    import('my-bad/presets'),
  ])
  return renderPage(report, {
    cwd: options.cwd,
    channel: options.channel,
    history: options.history,
    theme: { ...nuxtTheme, css: [nuxtTheme.css, PROGRESS_LABEL_CSS].filter(Boolean).join('\n') },
  })
}

/** Drop causes that only repeat what their parent already says. */
function withoutEchoingCauses(report: ErrorReport): ErrorReport {
  const causes = report.causes
    .filter(cause => cause.message !== report.message)
    .map(cause => withoutEchoingCauses(cause))
  return causes.length === report.causes.length && causes.every((cause, index) => cause === report.causes[index])
    ? report
    : { ...report, causes }
}

/** Render `report` for the terminal, with its own marker and colours. */
async function renderReportAnsi(report: ErrorReport, cwd?: string): Promise<string> {
  const { renderAnsi } = await import('my-bad')
  return renderAnsi(withoutEchoingCauses(report), { cwd })
}

/** Progress for the bar an open error page draws; `100` retires it. */
export function toBuildProgress(snapshot: ProgressSnapshot): BuildProgress {
  return {
    phase: snapshot.phase,
    percent: snapshot.status === 'error' ? undefined : Math.round(snapshot.progress * 100),
    message: snapshot.message,
  }
}

/** Publish to the channel if one exists, without creating it. */
export async function withErrorChannel(run: (channel: Channel) => void): Promise<void> {
  if (!channel) {
    return
  }
  try {
    run(await channel)
  }
  catch (error) {
    debug('Could not publish to the error channel:', error)
  }
}

/** Whether `message` is a report forwarded by the app. */
export function isDevErrorMessage(message: unknown): message is DevErrorMessage {
  const candidate = message as { type?: unknown, request?: unknown } | undefined
  if (candidate?.request !== undefined && typeof candidate.request !== 'string') {
    return false
  }
  const type = candidate?.type
  return type === 'nuxt:dev:error:report' || type === 'nuxt:dev:error:clear' || type === 'nuxt:dev:error:warning'
}

/**
 * A report as it crosses to the supervisor: the rendering to show it with, plus
 * enough to summarise it on a status line. The report itself stays in the
 * channel, which serves it from `/history/<id>`.
 */
export interface DevReportSummary {
  id: string
  name: string
  message: string
  /** Where the topmost frame of the project's own code points, if anywhere. */
  file?: string
  line?: number
  /** That position as `file:line:column`, relative to the project. */
  location?: string
  /** The request the report was raised for, shared with the logs attributed to it. */
  requestId?: number
  /** That request as `METHOD /path`, when the app raised this while serving one. */
  request?: string
  /** The report rendered for a terminal. */
  ansi: string
}

/** The compile error a report was caused by, when there is one. */
function findCompileReport(report: ErrorReport): ErrorReport | undefined {
  if (report.kind === 'compile') {
    return report
  }
  for (const cause of report.causes) {
    const compile = findCompileReport(cause)
    if (compile) {
      return compile
    }
  }
}

/** What the fork knows about a report beyond the report itself. */
export interface ReportContext {
  requestId?: number
  request?: string
}

/** Everything the supervisor needs to present `report`, rendered for a terminal. */
export async function summariseReport(report: ErrorReport, context: ReportContext = {}, cwd: string = process.cwd()): Promise<DevReportSummary> {
  // A request that hit a compile error is described by the compile error.
  const named = findCompileReport(report) ?? report
  const frames = named.frames.some(frame => frame.file) ? named.frames : report.frames
  const frame = frames.find(frame => frame.type === 'app' && frame.file) ?? frames.find(frame => frame.file)
  return {
    id: report.id,
    name: named.name,
    message: named.message,
    file: frame?.file,
    line: frame?.line,
    location: frame?.file && formatLocation(frame.file, frame.line, frame.column, cwd),
    requestId: context.requestId,
    request: context.request,
    ansi: await renderReportAnsi(report, cwd),
  }
}

/** `file:line:column`, relative to the project where it sits inside it. */
function formatLocation(file: string, line: number | undefined, column: number | undefined, cwd: string): string {
  const relativePath = relative(cwd, file)
  const path = !relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) ? file : `./${relativePath}`
  return [path, line, column].filter(part => part !== undefined).join(':')
}

/** The request that hit `report`, then its rendering. */
export function formatReportForTerminal(report: DevReportSummary): string {
  const body = report.ansi
  if (!report.request) {
    return body
  }
  const separator = report.request.indexOf(' ')
  const method = separator === -1 ? report.request : report.request.slice(0, separator)
  const path = separator === -1 ? '' : ` ${report.request.slice(separator + 1)}`
  return `[request error] [${method}]${path}\n\n  ${body.replaceAll('\n', '\n  ')}`
}

export interface ErrorBridgeHandlers {
  onReport?: (report: ErrorReport, context: ReportContext) => void
  onClear?: (id?: string) => void
}

/**
 * Receive the reports the app forwards, publishing them on the CLI's channel,
 * until the returned function is called.
 */
export function openErrorBridge(handlers: ErrorBridgeHandlers = {}, options: ErrorChannelOptions = {}): () => void {
  const broadcast = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
  broadcast.unref()
  broadcast.postMessage(SYNC_MESSAGE)
  broadcast.onmessage = (event: { data: unknown }) => {
    const message = event.data
    if (!isDevErrorMessage(message)) {
      return
    }
    void useErrorChannel(options).then((instance) => {
      switch (message.type) {
        case 'nuxt:dev:error:report': {
          instance.setError(message.report)
          handlers.onReport?.(message.report, { requestId: message.requestId, request: message.request })
          break
        }
        case 'nuxt:dev:error:warning': {
          instance.warn(message.report)
          break
        }
        case 'nuxt:dev:error:clear': {
          instance.clearError(message.id)
          handlers.onClear?.(message.id)
          break
        }
      }
    }).catch(error => debug('Could not handle a forwarded error report:', error))
  }
  return () => broadcast.close()
}

export async function closeErrorChannel(): Promise<void> {
  const instance = channel
  channel = undefined
  await instance?.then(open => open.close()).catch(() => {})
}
