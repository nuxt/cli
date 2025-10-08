import type { NuxtConfig } from '@nuxt/schema'
import type { DevServerListener, ListenOptions, NuxtDevContext, NuxtDevIPCMessage, NuxtParentIPCMessage } from './utils'

import { Server } from 'node:http'
import process from 'node:process'
import defu from 'defu'
import { createSocketListener } from './socket'
import { NuxtDevServer, resolveDevServerDefaults, resolveDevServerOverrides } from './utils'

async function createNetworkListener(handler: any, options: Partial<ListenOptions>): Promise<DevServerListener> {
  const server = new Server(handler)
  await new Promise<void>((resolve) => {
    server.listen({
      port: options.port,
      host: options.hostname,
    }, resolve)
  })

  const address = server.address() as any
  const protocol = options.https ? 'https' : 'http'
  const url = address
    ? `${protocol}://${address.address}:${address.port}`
    : ''

  return {
    server,
    url,
    https: options.https,
    address: address || { address: 'localhost', port: Number(options.port) || 3000, family: 'IPv4' },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err: Error | undefined) => err ? reject(err) : resolve())
      })
    },
    async getURLs() {
      return [{ url, https: !!options.https }]
    },
  }
}

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
    // only kill process if it is a fork
    if (this.enabled) {
      process.once('unhandledRejection', (reason) => {
        this.send({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
        process.exit()
      })
    }
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

  // Initialize dev server
  const devServer = new NuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(
      ctx.data?.overrides,
      ({ extends: devContext.args.extends } satisfies NuxtConfig) as NuxtConfig,
      devServerOverrides,
    ),
    defaults: devServerDefaults,
    logLevel: devContext.args.logLevel as 'silent' | 'info' | 'verbose',
    clear: devContext.args.clear,
    dotenv: { cwd: devContext.cwd, fileName: devContext.args.dotenv },
    envName: devContext.args.envName,
    devContext: {
      proxy: devContext.proxy,
    },
  })

  // _PORT is used by `@nuxt/test-utils` to launch the dev server on a specific port
  const listenOptions = _listenOptions === true || process.env._PORT
    ? { port: process.env._PORT ?? 0, hostname: '127.0.0.1', showURL: false }
    : _listenOptions

  // Attach internal listener
  devServer.listener = listenOptions
    ? await createNetworkListener(devServer.handler, listenOptions)
    : await createSocketListener(devServer.handler, devContext.proxy?.addr)

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.debug(`Using ${listenOptions ? 'network' : 'socket'} listener for Nuxt dev server.`)
  }

  // Merge interface with public context
  devServer.listener._url = devServer.listener.url
  if (devContext.proxy?.url) {
    devServer.listener.url = devContext.proxy.url
  }
  if (devContext.proxy?.urls) {
    const _getURLs = devServer.listener.getURLs.bind(devServer.listener)
    devServer.listener.getURLs = async () => Array.from(new Set([...devContext.proxy?.urls || [], ...(await _getURLs())]))
  }

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
      await devServer.close()
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
