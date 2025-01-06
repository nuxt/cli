import { resolve } from 'pathe'
import { defineCommand } from 'citty'
import { isTest } from 'std-env'

import { logger } from '../utils/logger'
import { overrideEnv } from '../utils/env'
import type { NuxtDevContext, NuxtDevIPCMessage } from '../utils/dev'
import { createNuxtDevServer } from '../utils/dev'
import { envNameArgs, legacyRootDirArgs, cwdArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: '_dev',
    description:
      'Run Nuxt development server (internal command to start child process)',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    if (!process.send && !isTest) {
      logger.warn(
        '`nuxi _dev` is an internal command and should not be used directly. Please use `nuxi dev` instead.',
      )
    }

    // Prepare
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    // Get dev context info
    const devContext: NuxtDevContext
      = JSON.parse(process.env.__NUXT_DEV__ || 'null') || {}

    // IPC Hooks
    function sendIPCMessage<T extends NuxtDevIPCMessage>(message: T) {
      if (process.send) {
        process.send(message)
      }
      else {
        logger.info(
          'Dev server event:',
          Object.entries(message)
            .map(e => e[0] + '=' + JSON.stringify(e[1]))
            .join(' '),
        )
      }
    }

    process.once('unhandledRejection', (reason) => {
      sendIPCMessage({ type: 'nuxt:internal:dev:rejection', message: reason instanceof Error ? reason.toString() : 'Unhandled Rejection' })
      process.exit()
    })

    // Init Nuxt dev
    const nuxtDev = await createNuxtDevServer({
      cwd,
      overrides: ctx.data?.overrides,
      logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      clear: !!ctx.args.clear,
      dotenv: !!ctx.args.dotenv,
      envName: ctx.args.envName,
      port: process.env._PORT ?? undefined,
      devContext,
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
  },
})
