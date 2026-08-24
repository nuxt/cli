import type { ListenURL } from '../listen'
import type { DevProgressSnapshot } from '../progress'
import type { DevLogEvent } from './events'
import type { PanelState } from './panel'
import type { DevUISupportOptions } from './support'

import process from 'node:process'
import { formatWithOptions, styleText } from 'node:util'

import { consola } from 'consola'

import { KEEPS_PROCESS_ALIVE } from '../../utils/errors'
import { debug, isEmittingCliLog, setLoggerImpl } from '../../utils/logger'
import { getPkgVersion } from '../../utils/pkg'
import { startupElapsedMs } from '../../utils/startup-clock'
import { resolveBackground } from '../../utils/terminal-theme'
import { currentRequest, isServingRequest } from '../serving-state'
import { queryBackground } from './background'
import { DevEventLog, normaliseMessage } from './events'
import { LOGO_FRAME_MS } from './logo'
import { DEFAULT_HINTS, describeListenURLs, renderPanel } from './panel'
import { resolveDevUISupport, supportsUnicode } from './support'
import { PanelSurface } from './surface'
import { stripAnsi } from './width'

const SHOW_CURSOR = '\u001B[?25h'

/** Long enough for a forwarded log to be paired with its printed output. */
const ERROR_SURFACE_DELAY_MS = 60

/** An error as it belongs in scrollback: as printed, or as reported. */
function renderErrorLine(event: DevLogEvent): string {
  return event.rendered ?? `${styleText(['red', 'bold'], 'ERROR')} ${event.message}`
}

/** Cursor movement and erasure: output that repaints rather than appends. */
// eslint-disable-next-line no-control-regex
const REWRITE_RE = /\r(?!\n)|\u001B\[[0-9;]*[A-GJK]/

/** Sequences a settled line no longer needs: movement, erasure, visibility. */
// eslint-disable-next-line no-control-regex
const CURSOR_RE = /\u001B\[[0-9;]*[A-GJK]|\u001B\[\?25[hl]/g

/** Whether `chunk` rewrites earlier output instead of adding to it. */
function isRewrite(chunk: string): boolean {
  return REWRITE_RE.test(chunk)
}

/**
 * What a run of self-rewriting output leaves on screen: each line keeps only
 * what follows its last carriage return, and the cursor control goes.
 */
function settleRewrites(plain: string): string {
  return plain
    .replaceAll(CURSOR_RE, '')
    .split('\n')
    .map(line => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n')
}

export interface DevUISession {
  surface: PanelSurface
  events: DevEventLog
  state: PanelState
  /** Redraw the panel from {@link state}. Replaced once the controller owns it. */
  render: () => void
  /** Put text into scrollback above the panel, once the current write unwinds. */
  surfaceText: (text: string) => void
  /**
   * Record that a log event has been emitted and its printed form has not
   * arrived yet, so the next captured chunk is recognised as its output rather
   * than as a tool writing to the stream directly.
   */
  expectRender: (event: DevLogEvent) => void
  /** Stop the session's own startup animation, once the controller drives it. */
  stopStartupTicker: () => void
  /** Narrate the current startup phase while the server is loading. */
  reportProgress: (snapshot: DevProgressSnapshot) => void
  /**
   * Show the bound address the moment the socket answers, spinning until the
   * resolved config confirms it. The full URL block replaces it on ready.
   */
  reportListening: (info: { urls: ListenURL[], confirmed: boolean }) => void
  /** Give the terminal back. Idempotent; extended by the controller. */
  teardown: (options?: { keep?: boolean }) => void
  /** Additional work to run inside {@link teardown}, in reverse order. */
  onTeardown: (task: () => void) => void
}

let current: DevUISession | undefined

/**
 * Take over the terminal before anything is loaded.
 *
 * Nuxt, Nitro and Vite all print during startup, so the panel has to be in
 * place and capturing before the dev server is initialised or the calm default
 * view would begin with a screen of build output.
 */
export function beginDevUI(options: DevUISupportOptions & { version?: string, cwd?: string, startTime?: number } = {}): DevUISession | undefined {
  const support = resolveDevUISupport(options)
  if (current || !support.enabled) {
    if (!current) {
      debug(`Interactive dev UI disabled: ${support.reason}`)
    }
    return current
  }

  const cwd = options.cwd || process.cwd()
  const state: PanelState = {
    status: 'starting',
    version: options.version || getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly') || undefined,
    warnings: 0,
    errors: 0,
    ascii: !supportsUnicode(),
    background: resolveBackground(),
    loadStartedAt: options.startTime ?? Date.now(),
    elapsedMs: 0,
    progress: 0,
    hints: DEFAULT_HINTS,
    hintsDimmed: true,
  }

  const events = new DevEventLog()
  const surface = new PanelSurface({ onResize: () => render() })

  // Nothing waits on the answer: the mark is painted in colours that are safe
  // on either background and repainted in the exact ones if a reply arrives.
  void queryBackground({ write: chunk => surface.writeRaw(chunk) }).then((background) => {
    if (background === 'unknown' || background === state.background) {
      return
    }
    state.background = background
    render()
  })

  let awaiting: DevLogEvent | undefined
  /** The entry the current run of self-rewriting frames is folded into. */
  let transient: DevLogEvent | undefined
  let buffered = ''
  let flushTimer: NodeJS.Immediate | undefined
  let surfacing: string[] = []
  let lastSurfacedError: string | undefined
  let torn = false
  let handlers: Array<[NodeJS.Signals | 'exit' | 'uncaughtException', (...args: any[]) => void]> = []
  const teardownTasks: Array<() => void> = []
  /** Errors whose surface delay has not fired yet, keyed by that timer. */
  const pendingErrors = new Map<NodeJS.Timeout, DevLogEvent>()

  // Nothing else repaints while Nuxt is loading, so the session drives the
  // shimmer and the elapsed time itself until the controller takes over.
  const startupTicker = setInterval(() => {
    if (state.status === 'ready' || state.status === 'error') {
      return
    }
    state.frame = (state.frame ?? 0) + 1
    state.elapsedMs = startupElapsedMs(state.loadStartedAt ?? Date.now())
    render()
  }, LOGO_FRAME_MS)
  startupTicker.unref?.()
  function stopStartupTicker(): void {
    clearInterval(startupTicker)
  }

  function render(): void {
    surface.render(renderPanel(state, process.stdout.columns || 80, process.stdout.rows || 24))
  }

  function reportProgress(snapshot: DevProgressSnapshot): void {
    if (snapshot.status === 'ready') {
      // Between the server accepting requests and answering one there is
      // nothing to watch but a badge, so it says which of the two has happened.
      state.awaitingFirstRender = !snapshot.serving
      state.note = snapshot.serving ? undefined : snapshot.message
      state.progress = snapshot.serving ? undefined : snapshot.progress
      if (state.status === 'ready' || state.status === 'warming') {
        state.status = snapshot.serving ? 'ready' : 'warming'
        render()
      }
      return
    }
    if (snapshot.status !== 'loading') {
      return
    }
    Object.assign(state, {
      status: snapshot.reload ? 'building' : 'starting',
      note: snapshot.message,
      loadStartedAt: Date.now() - snapshot.elapsed,
      elapsedMs: snapshot.elapsed,
      progress: snapshot.progress,
    } satisfies Partial<PanelState>)
    render()
  }

  function reportListening(info: { urls: ListenURL[], confirmed: boolean }): void {
    if (state.readyMs !== undefined) {
      return
    }
    state.urls = describeListenURLs(info.urls, { pending: !info.confirmed })
    render()
  }

  function surfaceText(text: string): void {
    surfacing.push(text)
    if (surfacing.length > 1) {
      return
    }
    queueMicrotask(() => {
      const pending = surfacing
      surfacing = []
      if (!pending.length) {
        return
      }
      for (const chunk of pending) {
        surface.writeAbove(chunk)
      }
    })
  }

  function expectRender(event: DevLogEvent): void {
    flushCapture()
    awaiting = event
  }

  /**
   * Fold everything captured since the last log event into one entry.
   *
   * A single log can reach the stream as several writes, so chunks are
   * accumulated and only split apart where a new log event begins or the tick
   * ends.
   */
  function flushCapture(): void {
    const chunk = buffered
    const owner = awaiting
    buffered = ''
    awaiting = undefined
    if (!chunk) {
      return
    }
    const plain = stripAnsi(chunk)
    if (owner) {
      transient = undefined
      owner.rendered = chunk
      return
    }
    const rewriting = isRewrite(chunk)
    const message = (rewriting ? settleRewrites(plain) : plain).replace(/\n+$/, '')
    if (!message.trim()) {
      return
    }
    // A spinner or progress bar redraws one line hundreds of times; each frame
    // rewrites the last, so together they are one entry that keeps up, not a
    // flood. The first plain line that follows ends the run.
    if (rewriting && transient) {
      Object.assign(transient, { time: Date.now(), message, rendered: chunk })
      return
    }
    if (!rewriting && events.attachRendered(chunk, plain)) {
      transient = undefined
      return
    }
    const stored = events.push({
      time: Date.now(),
      level: 2,
      type: 'log',
      message,
      rendered: chunk,
      raw: true,
      source: isServingRequest() ? 'runtime' : 'build',
      request: currentRequest()?.label,
      requestId: currentRequest()?.id,
    })
    transient = rewriting ? stored : undefined
  }

  /**
   * Write an error into scrollback above the panel.
   *
   * Delayed by a beat because a log forwarded from a fork arrives before the
   * output that renders it, and the rendered form is what should be shown.
   */
  function surfaceError(event: DevLogEvent): void {
    // Once the server has been ready, errors belong to the panel's badge and the
    // log view. Before that, one may be the last thing the process ever says.
    if (state.readyMs !== undefined) {
      return
    }
    const text = normaliseMessage(event.message)
    // A watcher that keeps failing the same way should say so once.
    if (event.surfaced || !text || text === lastSurfacedError) {
      return
    }
    event.surfaced = true
    lastSurfacedError = text
    const timer: NodeJS.Timeout = setTimeout(() => {
      pendingErrors.delete(timer)
      surfaceText(renderErrorLine(event))
    }, ERROR_SURFACE_DELAY_MS)
    timer.unref?.()
    pendingErrors.set(timer, event)
  }

  const reporter = {
    log(logObj: { level: number, type: string, tag?: string, args: unknown[] }) {
      expectRender(events.push({
        time: Date.now(),
        level: logObj.level,
        type: logObj.type,
        tag: logObj.tag || undefined,
        message: formatWithOptions({ colors: false }, ...logObj.args),
        // The app, the build and the CLI share this consola instance on one
        // thread, so origin is inferred: the CLI marks its own calls, and
        // anything logged while a request is open belongs to the runtime.
        source: isEmittingCliLog() ? 'cli' : isServingRequest() ? 'runtime' : 'build',
        raw: !isEmittingCliLog(),
        request: isEmittingCliLog() ? undefined : currentRequest()?.label,
        requestId: isEmittingCliLog() ? undefined : currentRequest()?.id,
      }))
    },
  }

  function teardown(teardownOptions: { keep?: boolean } = {}): void {
    if (torn) {
      return
    }
    torn = true
    current = undefined
    stopStartupTicker()
    clearImmediate(flushTimer)
    // A fatal startup error tears down and exits before the surface delay can
    // fire, and a dev server that dies without a trace is undebuggable.
    const unsurfaced = [...pendingErrors.entries()]
    for (const [timer] of unsurfaced) {
      clearTimeout(timer)
    }
    flushCapture()
    for (const task of teardownTasks.toReversed()) {
      task()
    }
    surface.externalOutput = 'passthrough'
    surface.writeRaw(SHOW_CURSOR)
    for (const [, event] of unsurfaced) {
      surface.writeRaw(`${renderErrorLine(event)}\n`)
    }
    surface.close({ keep: teardownOptions.keep })
    consola.removeReporter(reporter)
    setLoggerImpl()
    for (const [event, handler] of handlers) {
      process.off(event, handler)
    }
  }

  const session: DevUISession = {
    surface,
    events,
    state,
    render,
    surfaceText,
    expectRender,
    stopStartupTicker,
    reportProgress,
    reportListening,
    teardown,
    onTeardown: task => void teardownTasks.push(task),
  }

  events.onEvent((event) => {
    if (event.level <= 0) {
      surfaceError(event)
    }
  })

  consola.addReporter(reporter)

  // clack's connecting `│` guideline reads as a stray artefact when there is
  // a persistent panel, so CLI logs use plain consola styling instead.
  setLoggerImpl({
    info: message => consola.info(message),
    warn: message => consola.warn(message),
    error: message => consola.error(message),
    success: message => consola.success(message),
    step: message => consola.log(message),
    message: message => consola.log(message ?? ''),
  })

  surface.onExternalOutput((chunk) => {
    buffered += chunk
    if (flushTimer) {
      return
    }
    flushTimer = setImmediate(() => {
      flushTimer = undefined
      flushCapture()
    })
    flushTimer.unref?.()
  })
  surface.externalOutput = 'capture'

  const onSignal = () => teardown({ keep: true })
  // Merely listening for SIGHUP suppresses its default exit, and nothing else in
  // `nuxt dev` handles it, so a closed terminal would leave the server running
  // headless. 129 is the exit code the default disposition would have produced.
  const onHangup = () => {
    teardown({ keep: true })
    process.exit(129)
  }
  const onFatal = (error: unknown) => {
    // A handler that replaces the crashed server with a fork keeps this process
    // alive, so the panel stays with it.
    if (process.listeners('uncaughtException').some(listener => (listener as { [KEEPS_PROCESS_ALIVE]?: boolean })[KEEPS_PROCESS_ALIVE])) {
      return
    }
    teardown()
    console.error(error)
    process.exit(1)
  }
  handlers = [
    ['exit', onSignal],
    ['SIGINT', onSignal],
    ['SIGTERM', onSignal],
    ['SIGHUP', onHangup],
    // Raw mode and a pinned panel would otherwise outlive the crash: node
    // prints the error and exits without unwinding through `exit` first.
    ['uncaughtException', onFatal],
  ]
  for (const [event, handler] of handlers) {
    process.on(event, handler)
  }

  current = session
  render()
  surface.padToBottom()
  return session
}
