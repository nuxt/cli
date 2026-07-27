import type { NuxtConfig } from '@nuxt/schema'
import type { DevListenOverrides, Listener } from './listen'
import type { DevRestartReason } from './reason'
import type { NuxtDevContext, NuxtDevIPCMessage, NuxtParentIPCMessage } from './utils'

import process from 'node:process'
import defu from 'defu'
import { overrideEnv } from '../utils/env.ts'
import { isBrokenPipe } from '../utils/errors'
import { debug } from '../utils/logger'
import { startCpuProfile, stopCpuProfile } from '../utils/profile.ts'
import { openInspector } from './inspect'
import { NuxtDevServer } from './utils'

const start = Date.now()

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.toString() : 'Unhandled Rejection'
}

interface InitializeOptions {
  data?: {
    overrides?: NuxtConfig
  }
  listenOverrides?: DevListenOverrides
  showBanner?: boolean
}

// IPC Hooks
class IPC {
  enabled = !!process.send && !process.title?.includes('vitest') && process.env.__NUXT__FORK
  constructor() {
    // only kill process if it is a fork
    if (this.enabled) {
      // Without a parent there is nobody to reap this process, and it may be
      // holding the dev server port or the inspector port.
      process.once('disconnect', () => {
        process.exit(0)
      })
      process.once('unhandledRejection', (reason) => {
        this.send({ type: 'nuxt:internal:dev:rejection', message: formatErrorMessage(reason) })
        process.exit()
      })
    }
    process.on('message', async (message: NuxtParentIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:context') {
        if (message.inspect) {
          await openInspector(message.inspect)
        }
        await initialize(message.context, { listenOverrides: message.listenOverrides })
      }
    })
    this.send({ type: 'nuxt:internal:dev:fork-ready' })
  }

  send<T extends NuxtDevIPCMessage>(message: T) {
    if (this.enabled) {
      process.send?.(message)
    }
  }
}

const ipc = new IPC()

interface InitializeReturn {
  listener: Listener
  close: () => Promise<void>
  /** Reload Nuxt in place, keeping the current listener. */
  reload: (reason?: DevRestartReason) => Promise<void>
  onReady: (callback: (address: string) => void) => void
  /** Called the first time a watched file changes, before Nuxt reloads. */
  onFileChange: (callback: () => void) => void
  onRestart: (callback: (reason?: DevRestartReason) => void) => void
}

export async function initialize(devContext: NuxtDevContext, ctx: InitializeOptions = {}): Promise<InitializeReturn> {
  overrideEnv('development')

  const profileArg = devContext.args.profile
  const perfValue = profileArg === 'verbose' ? true : profileArg ? 'quiet' : undefined
  const perfOverrides = perfValue
    ? { debug: { perf: perfValue } } as NuxtConfig
    : {}

  if (profileArg) {
    await startCpuProfile()
  }

  const devServer = new NuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(
      ctx.data?.overrides,
      ({ extends: devContext.args.extends } satisfies NuxtConfig) as NuxtConfig,
      perfOverrides,
    ),
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: devContext.args.dotenv },
    envName: devContext.args.envName,
    showBanner: ctx.showBanner !== false && !ipc.enabled,
    listenOverrides: ctx.listenOverrides,
    handoverFrom: devContext.handoverFrom,
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

  // Init server
  await devServer.init()

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.debug(`Dev server (internal) initialized in ${Date.now() - start}ms`)
  }

  if (profileArg) {
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

  return {
    listener: devServer.listener,
    reload: (reason?: DevRestartReason) => devServer.load(true, reason),
    close: () => {
      closePromise ??= (async () => {
        devServer.closeWatchers()
        try {
          await Promise.all([
            devServer.listener.close(),
            devServer.close(),
          ])
        }
        finally {
          devServer.releaseLock()
        }
      })()
      return closePromise
    },
    onReady: (callback: (address: string) => void) => {
      if (address) {
        callback(address)
      }
      else {
        devServer.once('ready', payload => callback(payload))
      }
    },
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
    if (isBrokenPipe(error)) {
      debug('Ignoring broken pipe:', error)
      return
    }
    restart({ type: 'error', message: formatErrorMessage(error) })
  }

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
