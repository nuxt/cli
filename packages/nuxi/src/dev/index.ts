import type { NuxtConfig } from '@nuxt/schema'

import type { NuxtDevContext, NuxtDevIPCMessage } from './utils'
import process from 'node:process'
import defu from 'defu'
import { _getDevServerDefaults, _getDevServerOverrides, createNuxtDevServer } from './utils'

const start = Date.now()

// Prepare
process.env.NODE_ENV = 'development'

// Get dev context info
const devContext: NuxtDevContext = JSON.parse(process.env.__NUXT_DEV__ || '{}')

// IPC Hooks
function sendIPCMessage<T extends NuxtDevIPCMessage>(message: T) {
  if (process.send) {
    process.send(message)
  }
  else {
    // eslint-disable-next-line no-console
    console.info('Dev server event:', Object.entries(message).map(e => `${e[0]}=${JSON.stringify(e[1])}`).join(' '))
  }
}

process.once('unhandledRejection', (reason) => {
  sendIPCMessage({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
  process.exit()
})

const devServerOverrides = _getDevServerOverrides({
  public: devContext.public,
})

const devServerDefaults = _getDevServerDefaults({
  hostname: devContext.hostname,
  https: devContext.proxy?.https,
}, devContext.publicURLs)

interface InitializeOptions {
  data?: {
    overrides?: NuxtConfig
  }
  args?: {
    clear: boolean
    logLevel: string
    dotenv: string
    envName: string
  }
}

export async function initialize(ctx: InitializeOptions = {}) {
  const args = devContext.args || ctx.args || {} as NonNullable<Partial<NuxtDevContext['args']>>
  // Init Nuxt dev
  const nuxtDev = await createNuxtDevServer({
    cwd: devContext.cwd,
    overrides: defu(ctx.data?.overrides, devServerOverrides),
    defaults: devServerDefaults,
    logLevel: args.logLevel as 'silent' | 'info' | 'verbose',
    clear: !!args.clear,
    dotenv: { cwd: devContext.cwd, fileName: args.dotenv },
    envName: args.envName,
    port: process.env._PORT ?? undefined,
    devContext,
  })

  nuxtDev.on('loading:error', (_error) => {
    sendIPCMessage({ type: 'nuxt:internal:dev:loading:error', error: {
      message: _error.message,
      stack: _error.stack,
      name: _error.name,
      code: _error.code,
    } })
  })
  nuxtDev.on('loading', (message) => {
    sendIPCMessage({ type: 'nuxt:internal:dev:loading', message })
  })
  nuxtDev.on('restart', () => {
    sendIPCMessage({ type: 'nuxt:internal:dev:restart' })
  })
  nuxtDev.on('ready', (payload) => {
    sendIPCMessage({ type: 'nuxt:internal:dev:ready', port: payload.port })
  })

  // Init server
  await nuxtDev.init()

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.debug(`Dev server (internal) initialized in ${Date.now() - start}ms`)
  }
}

if (process.send) {
  // eslint-disable-next-line antfu/no-top-level-await
  await initialize()
}
