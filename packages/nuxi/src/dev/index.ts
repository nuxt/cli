import type { NuxtConfig } from '@nuxt/schema'
import type { Listener, ListenOptions } from 'listhen'
import type { NuxtDevContext, NuxtDevIPCMessage, NuxtParentIPCMessage } from './utils'

import process from 'node:process'
import defu from 'defu'
import { NuxtDevServer } from './utils'

const start = Date.now()

// Prepare
process.env.NODE_ENV = 'development'

interface InitializeOptions {
  data?: {
    overrides?: NuxtConfig
  }
  listenOverrides?: Partial<ListenOptions>
  showBanner?: boolean
}

// IPC Hooks
class IPC {
  enabled = !!process.send && !process.title?.includes('vitest') && process.env.__NUXT__FORK
  constructor() {
    // only kill process if it is a fork
    if (this.enabled) {
      process.once('unhandledRejection', (reason) => {
        this.send({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
        process.exit()
      })
    }
    process.on('message', (message: NuxtParentIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:context') {
        initialize(message.context, { listenOverrides: message.listenOverrides })
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
  onReady: (callback: (address: string) => void) => void
  onRestart: (callback: (devServer: NuxtDevServer) => void) => void
}

export async function initialize(devContext: NuxtDevContext, ctx: InitializeOptions = {}): Promise<InitializeReturn> {
  const devServer = new NuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(
      ctx.data?.overrides,
      ({ extends: devContext.args.extends } satisfies NuxtConfig) as NuxtConfig,
    ),
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: devContext.args.dotenv },
    envName: devContext.args.envName,
    showBanner: ctx.showBanner !== false && !ipc.enabled,
    listenOverrides: ctx.listenOverrides,
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
    devServer.on('restart', () => {
      ipc.send({ type: 'nuxt:internal:dev:restart' })
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

  return {
    listener: devServer.listener,
    close: async () => {
      devServer.closeWatchers()
      await Promise.all([
        devServer.listener.close(),
        devServer.close(),
      ])
    },
    onReady: (callback: (address: string) => void) => {
      if (address) {
        callback(address)
      }
      else {
        devServer.once('ready', payload => callback(payload))
      }
    },
    onRestart: (callback: (devServer: NuxtDevServer) => void) => {
      let restarted = false
      function restart() {
        if (!restarted) {
          restarted = true
          callback(devServer)
        }
      }
      devServer.once('restart', restart)
      process.once('uncaughtException', restart)
      process.once('unhandledRejection', restart)
    },
  }
}
