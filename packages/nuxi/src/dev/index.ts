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
  enabled = !!process.send && !process.title?.includes('vitest') && process.env.__NUXT__FORK
  constructor() {
    process.once('unhandledRejection', (reason) => {
      this.send({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
      process.exit()
    })
    process.on('message', (message: NuxtParentIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:context') {
        initialize(message.context, {}, message.socket ? undefined : true)
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

export async function initialize(devContext: NuxtDevContext, ctx: InitializeOptions = {}, _listenOptions?: true | Partial<ListenOptions>) {
  const devServerOverrides = resolveDevServerOverrides({
    public: devContext.public,
  })

  const devServerDefaults = resolveDevServerDefaults({
    hostname: devContext.hostname,
    https: devContext.proxy?.https,
  }, devContext.publicURLs)

  // _PORT is used by `@nuxt/test-utils` to launch the dev server on a specific port
  const listenOptions = _listenOptions === true || process.env._PORT
    ? { port: process.env._PORT ?? 0, hostname: '127.0.0.1', showURL: false }
    : _listenOptions

  // Init Nuxt dev
  const devServer = await createNuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(ctx.data?.overrides, devServerOverrides),
    defaults: devServerDefaults,
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: !!devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: devContext.args.dotenv },
    envName: devContext.args.envName,
    devContext,
  }, listenOptions)

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
    close: () => devServer.close(),
    onReady: (callback: (address: string) => void) => {
      if (address) {
        callback(address)
      }
      else {
        devServer.once('ready', payload => callback(payload))
      }
    },
    onRestart: (callback: (devServer: NuxtDevServer) => void) => {
      devServer.once('restart', () => callback(devServer))
    },
  }
}
