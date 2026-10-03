import type { ProgressSnapshot } from '../../utils/progress-snapshot'
import type { ListenURL } from '../listen'
import type { DevLogEvent } from './events'
import type { PanelStart, PanelStartOptions } from './first-frame'
import type { PanelState } from './panel'

import process from 'node:process'
import { formatWithOptions, styleText } from 'node:util'

import { consola } from 'consola'

import { KEEPS_PROCESS_ALIVE } from '../../utils/errors'
import { debug, isEmittingCliLog, setLoggerImpl } from '../../utils/logger'
import { READY_MESSAGE } from '../../utils/progress-snapshot'
import { startupElapsedMs } from '../../utils/startup-clock'
import { registerTerminalHost } from '../../utils/terminal-host'
import { currentRequest } from '../serving-state'
import { isShutdownAdopted } from '../shutdown'
import { queryBackground } from './background'
import { DevEventLog, isBoxedNotice, normaliseMessage, noteRoute } from './events'
import { createPanelState, renderPanelState, resolveNuxtVersion } from './first-frame'
import { LOGO_FRAME_MS } from './logo'
import { describeListenURLs } from './panel'
import { resolveDevUISupport } from './support'
import { PanelSurface } from './surface'
import { stripAnsi } from './width'

const SHOW_CURSOR = '\u001B[?25h'

/** Long enough for a forwarded log to be paired with its printed output. */
const ERROR_SURFACE_DELAY_MS = 60

/** Cursor movement and erasure: output that repaints rather than appends. */
// eslint-disable-next-line no-control-regex
const REWRITE_RE = /\r(?!\n)|\u001B\[[0-9;]*[A-GJK]/

/** Sequences a settled line no longer needs: movement, erasure, visibility. */
// eslint-disable-next-line no-control-regex
const CURSOR_RE = /\u001B\[[0-9;]*[A-GJK]|\u001B\[\?25[hl]/g

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
  reportProgress: (snapshot: ProgressSnapshot) => void
  /**
   * Repaint through the controller instead of {@link render} whenever progress
   * changes what is on the panel, so the controller can re-arm the animation it
   * owns: a render in flight is work, and a still panel reads as a hung one.
   */
  onProgressChange: (listener: () => void) => void
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

/** Point the running session at the project the resolved arguments name. */
let retargetCurrent: ((options: { cwd?: string, version?: string }) => void) | undefined

/** Give the terminal back, if this process has taken it. */
export function teardownDevUI(): void {
  current?.teardown()
}

/**
 * Take over the terminal before anything is loaded.
 *
 * Nuxt, Nitro and Vite all print during startup, so the panel has to be in
 * place and capturing before the dev server is initialised or the calm default
 * view would begin with a screen of build output.
 */
export function beginDevUI(options: PanelStartOptions & { start?: PanelStart } = {}): DevUISession | undefined {
  const support = resolveDevUISupport(options)
  if (current) {
    // Only the arguments can refuse a panel that is already up; the terminal
    // it was started in has not changed.
    if (support.reason === 'flag' || support.reason === 'inspector') {
      debug(`Interactive dev UI disabled: ${support.reason}`)
      current.teardown()
      return undefined
    }
    retargetCurrent?.(options)
    return current
  }
  if (!support.enabled) {
    debug(`Interactive dev UI disabled: ${support.reason}`)
    return undefined
  }

  const cwd = options.cwd || process.cwd()
  const state = options.start?.state ?? createPanelState(options)

  const events = new DevEventLog()
  const surface = options.start?.surface ?? new PanelSurface()
  surface.onResize(() => render())

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
  /** Text whose surface delay has not fired yet, keyed by that timer. */
  const pendingSurfaces = new Map<NodeJS.Timeout, () => string>()

  // Nothing else repaints while Nuxt is loading, so the session drives the
  // shimmer and the elapsed time itself until the controller takes over.
  const startupTicker = setInterval(() => {
    if (state.status === 'ready' || state.status === 'error') {
      return
    }
    state.frame = (state.frame ?? 0) + 1
    state.elapsedMs = startupElapsedMs(state.loadStartedAt ?? Date.now())
    state.phaseElapsedMs = state.phaseStartedAt === undefined ? undefined : Date.now() - state.phaseStartedAt
    render()
  }, LOGO_FRAME_MS)
  startupTicker.unref?.()
  function stopStartupTicker(): void {
    clearInterval(startupTicker)
  }

  function render(): void {
    renderPanelState(surface, state)
  }

  // Startup questions are asked before the controller exists, so the terminal
  // is lent from here too.
  const tasks: Array<{ label: string, startedAt: number }> = []
  const releaseHost = registerTerminalHost({
    version: 1,
    withTerminal: async (work) => {
      const resume = surface.suspend()
      try {
        return await work()
      }
      finally {
        if (!torn) {
          resume()
        }
      }
    },
    startTask: (label) => {
      const task = { label, startedAt: Date.now() }
      tasks.push(task)
      state.task = tasks.at(-1)
      repaint()
      const forget = () => {
        const index = tasks.indexOf(task)
        if (index !== -1) {
          tasks.splice(index, 1)
        }
        state.task = tasks.at(-1)
        repaint()
      }
      return {
        update: (next) => {
          task.label = next
          repaint()
        },
        stop: forget,
      }
    },
  })
  teardownTasks.push(releaseHost)

  let progressListener: (() => void) | undefined

  /** Repaint through the controller where one is attached, so it sees the change. */
  function repaint(): void {
    if (progressListener) {
      progressListener()
      return
    }
    render()
  }

  function reportProgress(snapshot: ProgressSnapshot): void {
    if (snapshot.status === 'ready') {
      // Between the server accepting requests and answering one there is
      // nothing to watch but a badge, so it says which of the two has happened.
      // Something already waiting for a page is a state of the load; the request
      // being rendered is not, and is held separately so that a load reporting
      // itself ready again cannot take it off the panel.
      const waiting = !snapshot.serving && snapshot.message !== READY_MESSAGE
      state.awaitingFirstRender = !snapshot.serving
      state.note = waiting ? snapshot.message : undefined
      state.progress = waiting ? snapshot.progress : undefined
      state.rendering = snapshot.pending && { label: snapshot.pending.label, startedAt: snapshot.pending.startedAt }
      state.renderingMs = snapshot.pending && Date.now() - snapshot.pending.startedAt
      state.phaseStartedAt = undefined
      state.phaseElapsedMs = undefined
      if (state.status === 'ready' || state.status === 'warming') {
        state.status = waiting ? 'warming' : 'ready'
      }
      repaint()
      return
    }
    if (snapshot.status !== 'loading') {
      return
    }
    Object.assign(state, {
      status: snapshot.reload ? 'building' : 'starting',
      note: snapshot.message,
      // A load starting voids whatever was being rendered against the last one.
      rendering: undefined,
      renderingMs: undefined,
      loadStartedAt: Date.now() - snapshot.elapsed,
      elapsedMs: snapshot.elapsed,
      phaseStartedAt: Date.now() - snapshot.phaseElapsed,
      phaseElapsedMs: snapshot.phaseElapsed,
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
      noteRoute(owner, 'output')
      return
    }
    const rewriting = REWRITE_RE.test(chunk)
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
    const request = currentRequest()
    const event: DevLogEvent = {
      time: Date.now(),
      level: 2,
      type: 'log',
      message,
      rendered: chunk,
      source: request ? 'runtime' : 'build',
      request: request?.label,
      requestId: request?.id,
    }
    const stored = events.push(event, { route: 'output' })
    // Only an entry of this run's own may be rewritten by its later frames:
    // `push` can merge into an existing structured event, whose message is a
    // real log that has to survive.
    transient = rewriting && stored === event ? stored : undefined
  }

  /**
   * Write `event` into scrollback above the panel, as printed or else as
   * `fallback`, once it has had time to be paired with its printed form: a log
   * forwarded from a fork arrives before the output that renders it.
   */
  function surfaceLater(event: DevLogEvent, fallback: string): void {
    event.surfaced = true
    const render = () => event.rendered ?? fallback
    const timer: NodeJS.Timeout = setTimeout(() => {
      pendingSurfaces.delete(timer)
      surfaceText(render())
    }, ERROR_SURFACE_DELAY_MS)
    timer.unref?.()
    pendingSurfaces.set(timer, render)
  }

  /**
   * Boxed notices carry something (a URL, a token) that has to be readable and
   * selectable, so they reach scrollback at any point. Errors and CLI warnings
   * only do before the server is first ready; after that they belong to the
   * badge and the log view.
   */
  function surfaceEvent(event: DevLogEvent): void {
    const text = normaliseMessage(event.message)
    if (event.surfaced || !text) {
      return
    }
    if (isBoxedNotice(event)) {
      return surfaceLater(event, `${event.message}\n`)
    }
    if (state.readyMs !== undefined) {
      return
    }
    // A watcher that keeps failing the same way should say so once.
    if (event.level <= 0 && text !== lastSurfacedError) {
      lastSurfacedError = text
      surfaceLater(event, `${styleText(['red', 'bold'], 'ERROR')} ${event.message}`)
    }
    else if (event.level === 1 && event.source === 'cli') {
      surfaceLater(event, `${styleText(['yellow', 'bold'], 'WARN')} ${event.message}`)
    }
  }

  const reporter = {
    log(logObj: { level: number, type: string, tag?: string, args: unknown[] }) {
      const cli = isEmittingCliLog()
      const request = cli ? undefined : currentRequest()
      expectRender(events.push({
        time: Date.now(),
        level: logObj.level,
        type: logObj.type,
        tag: logObj.tag || undefined,
        message: formatWithOptions({ colors: false }, ...logObj.args),
        // The app, the build and the CLI share this consola instance on one
        // thread, so origin is inferred: the CLI marks its own calls, and
        // anything logged while a request is open belongs to the runtime.
        source: cli ? 'cli' : request ? 'runtime' : 'build',
        request: request?.label,
        requestId: request?.id,
      }, {
        // A log the CLI wrote itself reaches the UI no other way.
        route: cli ? undefined : 'reporter',
      }))
    },
  }

  function teardown(teardownOptions: { keep?: boolean } = {}): void {
    if (torn) {
      return
    }
    torn = true
    current = undefined
    retargetCurrent = undefined
    stopStartupTicker()
    clearImmediate(flushTimer)
    // A fatal startup error tears down and exits before the surface delay can
    // fire, and a dev server that dies without a trace is undebuggable.
    const unsurfaced = [...pendingSurfaces.entries()]
    for (const [timer] of unsurfaced) {
      clearTimeout(timer)
    }
    flushCapture()
    for (const task of teardownTasks.toReversed()) {
      task()
    }
    surface.externalOutput = 'passthrough'
    surface.writeRaw(SHOW_CURSOR)
    for (const [, render] of unsurfaced) {
      surface.writeRaw(`${render()}\n`)
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
    onProgressChange: (listener) => {
      progressListener = listener
    },
    reportListening,
    teardown,
    onTeardown: task => void teardownTasks.push(task),
  }

  events.onEvent(surfaceEvent)

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
  const onInterrupt = (code: number) => () => {
    teardown({ keep: true })
    if (!isShutdownAdopted()) {
      process.exit(code)
    }
  }
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
    ['SIGINT', onInterrupt(130)],
    ['SIGTERM', onInterrupt(143)],
    ['SIGHUP', onHangup],
    // Raw mode and a pinned panel would otherwise outlive the crash: node
    // prints the error and exits without unwinding through `exit` first.
    ['uncaughtException', onFatal],
  ]
  for (const [event, handler] of handlers) {
    process.on(event, handler)
  }

  current = session
  retargetCurrent = (next) => {
    const version = resolveNuxtVersion({ version: next.version, cwd: next.cwd || cwd })
    if (version === state.version) {
      return
    }
    state.version = version
    render()
  }
  if (!options.start) {
    render()
    surface.padToBottom()
  }
  return session
}
