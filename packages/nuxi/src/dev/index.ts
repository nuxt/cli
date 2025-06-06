import type { NuxtConfig } from '@nuxt/schema'
import type { ListenOptions } from 'listhen'
import type { NuxtDevContext, NuxtDevIPCMessage, NuxtDevServer, NuxtParentIPCMessage } from './utils'

import process from 'node:process'
import defu from 'defu'
import { createNuxtDevServer, resolveDevServerDefaults, resolveDevServerOverrides } from './utils'

const start = Date.now()

// Prepare
process.env.NODE_ENV = 'development'

interface InitializeOptions {
  data?: {
    overrides?: NuxtConfig
  }
}

// IPC Hooks
class IPC {
  enabled = !!process.send && !process.title.includes('vitest') && process.env.__NUXT__FORK
  constructor() {
    process.once('unhandledRejection', (reason) => {
      this.send({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
      process.exit()
    })
    process.on('message', (message: NuxtParentIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:context') {
        initialize(message.context)
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

export async function initialize(devContext: NuxtDevContext, ctx: InitializeOptions = {}, listenOptions?: Partial<ListenOptions>) {
  const devServerOverrides = resolveDevServerOverrides({
    public: devContext.public,
  })

  const devServerDefaults = resolveDevServerDefaults({
    hostname: devContext.hostname,
    https: devContext.proxy?.https,
  }, devContext.publicURLs)

  // Init Nuxt dev
  const devServer = await createNuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(ctx.data?.overrides, devServerOverrides),
    defaults: devServerDefaults,
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: !!devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: devContext.args.dotenv },
    envName: devContext.args.envName,
    port: process.env._PORT ?? undefined,
    devContext,
  }, listenOptions)

  let port: number

  if (ipc.enabled) {
    devServer.on('loading:error', (_error) => {
      ipc.send({
        type: 'nuxt:internal:dev:loading:error',
        error: {
          message: _error.message,
          stack: _error.stack,
          name: _error.name,
          code: _error.code,
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
      ipc.send({ type: 'nuxt:internal:dev:ready', port: payload.port })
    })
  }
  else {
    devServer.on('ready', (payload) => {
      port = payload.port
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
    onReady: (callback: (port: number) => void) => {
      if (port) {
        callback(port)
      }
      else {
        devServer.once('ready', payload => callback(payload.port))
      }
    },
    onRestart: (callback: (devServer: NuxtDevServer) => void) => {
      devServer.once('restart', () => callback(devServer))
    },
  }
}
