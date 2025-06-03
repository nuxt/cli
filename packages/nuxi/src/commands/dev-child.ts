import type { NuxtDevContext } from '../utils/dev'
import process from 'node:process'

import { defineCommand } from 'citty'
import defu from 'defu'
import { resolve } from 'pathe'
import { isTest } from 'std-env'

import { _getDevServerDefaults, _getDevServerOverrides, createNuxtDevServer } from '../utils/dev'
import { overrideEnv } from '../utils/env'
import { logger } from '../utils/logger'
import { HybridIPCManager } from '../utils/socket-ipc'
import { cwdArgs, dotEnvArgs, envNameArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: '_dev',
    description: 'Run Nuxt development server (internal command to start child process)',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...dotEnvArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    if (!process.send && !isTest && !process.env.__NUXT_DEV_SOCKET_PATH__) {
      logger.warn('`nuxi _dev` is an internal command and should not be used directly. Please use `nuxi dev` instead.')
    }

    // Prepare
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    // Get dev context info
    const devContext: NuxtDevContext = JSON.parse(process.env.__NUXT_DEV__ || 'null') || {}

    // Initialize IPC (socket or built-in)
    const socketPath = process.env.__NUXT_DEV_SOCKET_PATH__
    const ipcManager = new HybridIPCManager(false, socketPath)
    await ipcManager.initialize()

    process.once('unhandledRejection', (reason) => {
      ipcManager.send({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
      process.exit()
    })

    // Cleanup socket on exit
    process.on('exit', async () => {
      await ipcManager.cleanup()
    })

    const devServerOverrides = _getDevServerOverrides({
      public: devContext.public,
    })

    const devServerDefaults = _getDevServerDefaults({
      hostname: devContext.hostname,
      https: devContext.proxy?.https,
    }, devContext.publicURLs)

    // Init Nuxt dev
    const nuxtDev = await createNuxtDevServer({
      cwd,
      overrides: defu(ctx.data?.overrides, devServerOverrides),
      defaults: devServerDefaults,
      logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      clear: !!ctx.args.clear,
      dotenv: { cwd, fileName: ctx.args.dotenv },
      envName: ctx.args.envName,
      port: process.env._PORT ?? undefined,
      devContext,
    })

    nuxtDev.on('loading:error', (_error) => {
      ipcManager.send({ type: 'nuxt:internal:dev:loading:error', error: {
        message: _error.message,
        stack: _error.stack,
        name: _error.name,
        code: _error.code,
      } })
    })
    nuxtDev.on('loading', (message) => {
      ipcManager.send({ type: 'nuxt:internal:dev:loading', message })
    })
    nuxtDev.on('restart', () => {
      ipcManager.send({ type: 'nuxt:internal:dev:restart' })
    })
    nuxtDev.on('ready', (payload) => {
      ipcManager.send({ type: 'nuxt:internal:dev:ready', port: payload.port })
    })

    // Init server
    await nuxtDev.init()
  },
})
