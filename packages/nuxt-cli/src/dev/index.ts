/* eslint-disable perfectionist/sort-imports -- `./force-tty` must be evaluated before anything that loads `std-env` or `consola` */
import type { NuxtConfig } from '@nuxt/schema'
import type { DevListenOverrides, Listener, ListenURL } from './listen'
import type { DevProgressSnapshot } from './progress'
import type { DevRestartReason } from './reason'
import type { ServerLogEvent } from './log-channel'
import type { DevRequestEvent, DevRoutes, NuxtDevContext, NuxtDevIPCMessage, NuxtParentIPCMessage } from './utils'

import process from 'node:process'

import './force-tty'

import { formatWithOptions } from 'node:util'
import { consola } from 'consola'
import defu from 'defu'
import { resolveDotenvFileNames } from '../utils/args'
import { configureProjectConsola } from '../utils/console'
import { overrideEnv } from '../utils/env.ts'
import { isRemotePeerError, KEEPS_PROCESS_ALIVE } from '../utils/errors'
import { debug } from '../utils/logger'
import { startCpuProfile, stopCpuProfile } from '../utils/profile.ts'
import { openInspector } from './inspect'
import { openDevLogChannel } from './log-channel'
import { currentRequest, isServingRequest } from './serving-state'
import { createStartupReporter } from './startup-log'
import { NuxtDevServer } from './utils'

const start = Date.now()

const REQUEST_FLUSH_MS = 100
const REQUEST_BATCH_LIMIT = 200
const PENDING_REQUEST_BATCHES = 20
const PENDING_LOG_LIMIT = 500

/**
 * A fan-out that replays to the first subscriber, keeping at most `limit`
 * values.
 *
 * The server logs, serves and reports routes while it loads, which is before
 * the caller of {@link initialize} has had a chance to subscribe.
 */
function createFeed<T>(limit: number) {
  const callbacks = new Set<(value: T) => void>()
  const pending: T[] = []
  return {
    emit(value: T): void {
      if (!callbacks.size) {
        pending.push(value)
        pending.splice(0, Math.max(0, pending.length - limit))
        return
      }
      for (const callback of callbacks) {
        callback(value)
      }
    },
    subscribe(callback: (value: T) => void): void {
      callbacks.add(callback)
      for (const value of pending.splice(0)) {
        callback(value)
      }
    },
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.toString() : 'Unhandled Rejection'
}

/**
 * Hand an unhandled rejection to the parent process and stop this one, unless
 * it is only a client that went away. That is traffic, not a crash, and the
 * session has to survive it.
 */
export function createRejectionHandler(report: (message: string) => void, stop: () => void): (reason: unknown) => void {
  return (reason: unknown) => {
    if (isRemotePeerError(reason)) {
      debug('Ignoring remote peer error:', reason)
      return
    }
    report(formatErrorMessage(reason))
    stop()
  }
}

interface InitializeOptions {
  data?: {
    overrides?: NuxtConfig
  }
  listenOverrides?: DevListenOverrides
  showBanner?: boolean
  /** Feed logs and request events to the interactive dev UI. */
  captureUIEvents?: boolean
  /**
   * Called with every startup progress snapshot, from before the first load
   * begins, so a UI can narrate startup as it happens rather than after.
   */
  onProgress?: (snapshot: DevProgressSnapshot) => void
  /**
   * Called as soon as a socket is bound, milliseconds into startup, and again
   * with `confirmed` once the resolved config has agreed with the address.
   */
  onListening?: (info: { url: string, urls: ListenURL[], confirmed: boolean }) => void
}

class IPC {
  enabled = !!process.send && !process.title?.includes('vitest') && process.env.__NUXT__FORK
  #shutdown?: () => Promise<void>
  #closing?: Promise<void>

  constructor() {
    // only kill process if it is a fork
    if (this.enabled) {
      // The terminal delivers Ctrl-C to the whole process group, so this fork has to
      // run its own shutdown rather than being terminated mid-request.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => void this.close())
      }
      // Without a parent there is nobody to reap this process, and it may be
      // holding the dev server port or the inspector port. A shutdown that is
      // already running exits on its own once the `close` hooks have finished.
      process.once('disconnect', () => {
        if (!this.#closing) {
          process.exit(0)
        }
      })
      process.on('unhandledRejection', createRejectionHandler(
        message => this.send({ type: 'nuxt:internal:dev:rejection', message }),
        () => process.exit(),
      ))
    }
    process.on('message', async (message: NuxtParentIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:context') {
        if (message.inspect) {
          await openInspector(message.inspect)
        }
        await initialize(message.context, { listenOverrides: message.listenOverrides })
      }
      else if (message.type === 'nuxt:internal:dev:shutdown') {
        await this.close()
      }
      else if (message.type === 'nuxt:internal:dev:resize') {
        process.env.__NUXT_DEV_COLUMNS__ = String(message.columns)
      }
    })
    this.send({ type: 'nuxt:internal:dev:fork-ready' })
  }

  /** Register the shutdown routine to run before this fork exits. */
  onShutdown(handler: () => Promise<void>): void {
    this.#shutdown = handler
  }

  /**
   * Run the dev server's `close` hooks to completion before exiting, so user code
   * (nitro plugins, database connections) can tear itself down.
   */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      try {
        await this.#shutdown?.()
      }
      catch (error) {
        debug('Could not shut the dev server down cleanly:', error)
      }
      finally {
        process.exit(0)
      }
    })()
    return this.#closing
  }

  send<T extends NuxtDevIPCMessage>(message: T) {
    if (this.enabled) {
      process.send?.(message)
    }
  }
}

const ipc = new IPC()

// The parent's UI needs structured log events for the error badge and the log
// history, not just the formatted text it gets from the piped stdio. Forks
// never run `setupGlobalConsole`, so the date column and `console.*` wrapping
// are set up here to match what the parent does while it serves.
if (ipc.enabled && process.env.__NUXT_DEV_PIPED_TTY__) {
  consola.options.formatOptions.date = false
  consola.wrapAll()
  consola.addReporter({
    log(logObj) {
      ipc.send({
        type: 'nuxt:internal:dev:log',
        level: logObj.level,
        logType: logObj.type,
        tag: logObj.tag || undefined,
        message: formatWithOptions({ colors: false }, ...logObj.args),
        origin: isServingRequest() ? 'runtime' : 'build',
        request: currentRequest()?.label,
        requestId: currentRequest()?.id,
      })
    },
  })
}

interface InitializeReturn {
  listener: Listener
  close: () => Promise<void>
  /** Reload Nuxt in place, keeping the current listener. */
  reload: (reason?: DevRestartReason) => Promise<void>
  onReady: (callback: (address: string) => void) => void
  /** Called whenever the server starts loading Nuxt (initial load and in-place reloads). */
  onLoading: (callback: (message: string) => void) => void
  /** Called on every `ready`, unlike {@link onReady} which fires once. */
  onEachReady: (callback: () => void) => void
  /** Called with structured logs captured from the project's consola. */
  onLog: (callback: (log: ServerLogEvent) => void) => void
  /** Called with batches of served requests. */
  onRequests: (callback: (requests: DevRequestEvent[]) => void) => void
  /** Called when a server-side rebuild starts and finishes. */
  onBuilding: (callback: (building: boolean) => void) => void
  /** Called whenever the app's routes are (re)discovered. */
  onRoutes: (callback: (routes: DevRoutes) => void) => void
  /** Called the first time a watched file changes, before Nuxt reloads. */
  onFileChange: (callback: () => void) => void
  onRestart: (callback: (reason?: DevRestartReason) => void) => void
}

export async function initialize(devContext: NuxtDevContext, ctx: InitializeOptions = {}): Promise<InitializeReturn> {
  overrideEnv('development')

  await configureProjectConsola(devContext.cwd)

  const profileArg = devContext.args.profile
  const profiling = profileArg !== undefined
  const perfValue = profileArg === 'verbose' ? true : profiling ? 'quiet' : undefined
  const perfOverrides = perfValue
    ? { debug: { perf: perfValue } } as NuxtConfig
    : {}

  if (profiling) {
    await startCpuProfile()
  }

  // A piped fork captures for the parent's UI; otherwise the caller decides.
  const captureUIEvents = ipc.enabled ? !!process.env.__NUXT_DEV_PIPED_TTY__ : !!ctx.captureUIEvents

  const devServer = new NuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(
      ctx.data?.overrides,
      ({ extends: devContext.args.extends } satisfies NuxtConfig) as NuxtConfig,
      perfOverrides,
    ),
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: resolveDotenvFileNames(devContext.args.dotenv) },
    envName: devContext.args.envName,
    showBanner: ctx.showBanner !== false && !ipc.enabled,
    listenOverrides: ctx.listenOverrides,
    handoverFrom: devContext.handoverFrom,
    captureUIEvents,
  })

  let address: string

  if (ipc.enabled) {
    devServer.on('loading:error', (_error) => {
      ipc.send({
        type: 'nuxt:internal:dev:loading:error',
        error: {
          message: _error.message,
          stack: _error.stack,
          name: _error.name,
          code: 'code' in _error ? _error.code : undefined,
        },
      })
    })
    devServer.on('loading', (message) => {
      ipc.send({ type: 'nuxt:internal:dev:loading', message })
    })
    devServer.on('restart', (reason) => {
      ipc.send({ type: 'nuxt:internal:dev:restart', reason })
    })
    devServer.on('ready', (payload) => {
      ipc.send({ type: 'nuxt:internal:dev:ready', address: payload })
    })
  }
  else {
    devServer.on('ready', (payload) => {
      address = payload
    })
  }

  const logs = createFeed<ServerLogEvent>(PENDING_LOG_LIMIT)
  const requests = createFeed<DevRequestEvent[]>(PENDING_REQUEST_BATCHES)
  const routes = createFeed<DevRoutes>(1)
  const building = createFeed<boolean>(0)

  let closeLogChannel: (() => void) | undefined
  if (captureUIEvents) {
    closeLogChannel = openDevLogChannel((log) => {
      if (ipc.enabled) {
        ipc.send({ type: 'nuxt:internal:dev:log', ...log })
        return
      }
      logs.emit(log)
    })

    devServer.on('building', (value) => {
      if (ipc.enabled) {
        ipc.send({ type: 'nuxt:internal:dev:building', building: value })
        return
      }
      building.emit(value)
    })

    devServer.on('routes', (payload) => {
      if (ipc.enabled) {
        ipc.send({ type: 'nuxt:internal:dev:routes', payload })
        return
      }
      routes.emit(payload)
    })

    // A dev server serves a request per module on a cold page load, so requests
    // are batched rather than sent one IPC message at a time.
    let batch: DevRequestEvent[] = []
    let flushTimer: NodeJS.Timeout | undefined
    devServer.on('request', (event) => {
      batch.push(event)
      if (batch.length > REQUEST_BATCH_LIMIT) {
        batch.shift()
      }
      flushTimer ??= setTimeout(() => {
        flushTimer = undefined
        const flushed = batch
        batch = []
        if (!flushed.length) {
          return
        }
        if (ipc.enabled) {
          ipc.send({ type: 'nuxt:internal:dev:requests', requests: flushed })
          return
        }
        requests.emit(flushed)
      }, REQUEST_FLUSH_MS)
      flushTimer.unref?.()
    })
  }
  if (ctx.onProgress) {
    devServer.progress.onUpdate(ctx.onProgress)
  }
  if (ctx.onListening) {
    devServer.on('listening', info => ctx.onListening!(info))
  }

  // With the interactive UI the panel owns the terminal and reports startup
  // itself, so the transient reporter line would only fight it for the screen.
  const reporter = devContext.args.logLevel === 'silent' || ipc.enabled || ctx.captureUIEvents
    ? undefined
    : createStartupReporter()
  const unsubscribeProgress = reporter && devServer.progress.onUpdate(reporter.update)

  try {
    await devServer.init()
  }
  finally {
    unsubscribeProgress?.()
    reporter?.stop()
  }

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.debug(`Dev server (internal) initialized in ${Date.now() - start}ms`)
  }

  if (profiling) {
    for (const signal of [
      'exit',
      'SIGTERM' /* Graceful shutdown */,
      'SIGINT' /* Ctrl-C */,
      'SIGQUIT' /* Ctrl-\ */,
    ] as const) {
      process.once(signal, () => stopCpuProfile(devContext.cwd, 'dev'))
    }
  }

  let closePromise: Promise<void> | undefined

  const armRestart = createRestartHook(devServer)

  const close = () => {
    closePromise ??= (async () => {
      closeLogChannel?.()
      devServer.closeWatchers()
      try {
        await Promise.all([
          devServer.listener.close(),
          devServer.close(),
        ])
      }
      finally {
        devServer.progress.close()
        devServer.releaseLock()
      }
    })()
    return closePromise
  }

  ipc.onShutdown(close)

  return {
    listener: devServer.listener,
    reload: (reason?: DevRestartReason) => devServer.load(true, reason),
    close,
    onReady: (callback: (address: string) => void) => {
      if (address) {
        callback(address)
      }
      else {
        devServer.once('ready', payload => callback(payload))
      }
    },
    onLoading: (callback: (message: string) => void) => {
      devServer.on('loading', callback)
    },
    onEachReady: (callback: () => void) => {
      devServer.on('ready', () => callback())
    },
    onLog: logs.subscribe,
    onRequests: requests.subscribe,
    onBuilding: building.subscribe,
    onRoutes: routes.subscribe,
    onFileChange: (callback: () => void) => {
      devServer.once('change', callback)
    },
    onRestart: armRestart,
  }
}

interface RestartSource {
  once: (event: 'restart', handler: (reason?: DevRestartReason) => void) => void
  off: (event: 'restart', handler: (reason?: DevRestartReason) => void) => void
}

/**
 * Connect the triggers for a hard restart (an explicit `restart` event, and
 * errors that leave this process unable to serve) to a single callback, which
 * fires at most once per arming. Re-arming after a restart that could not be
 * completed swaps the callback in without stacking another set of listeners.
 */
export function createRestartHook(source: RestartSource): (callback: (reason?: DevRestartReason) => void) => void {
  let callback: ((reason?: DevRestartReason) => void) | undefined
  let fired = false
  let armed = false

  function restart(reason?: DevRestartReason) {
    if (fired) {
      return
    }
    fired = true
    armed = false
    // An error-triggered restart leaves the `restart` listener in place, since
    // `once` only removes it when the event itself fires.
    source.off('restart', restart)
    process.off('uncaughtException', restartOnError)
    process.off('unhandledRejection', restartOnError)
    callback?.(reason)
  }

  function restartOnError(error: unknown) {
    if (isRemotePeerError(error)) {
      debug('Ignoring remote peer error:', error)
      return
    }
    restart({ type: 'error', message: formatErrorMessage(error) })
  }
  restartOnError[KEEPS_PROCESS_ALIVE] = true

  return (next: (reason?: DevRestartReason) => void) => {
    callback = next
    fired = false
    if (armed) {
      return
    }
    armed = true
    source.once('restart', restart)
    process.on('uncaughtException', restartOnError)
    process.on('unhandledRejection', restartOnError)
  }
}
