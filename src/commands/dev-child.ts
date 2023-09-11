import { resolve } from 'pathe'
import { consola } from 'consola'
import { overrideEnv } from '../utils/env'
import { defineCommand } from 'citty'
import { sharedArgs, legacyRootDirArgs } from './_shared'
import { isTest } from 'std-env'
import { NuxtDevIPCMessage, createNuxtDevServer } from '../utils/dev'
import type { ListenURL, HTTPSOptions } from 'listhen'

export type DevChildContext = {
  url?: string
  urls?: ListenURL[]
  https?: boolean | HTTPSOptions
}

export default defineCommand({
  meta: {
    name: '_dev',
    description:
      'Run nuxt development server (internal command to start child process)',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const logger = consola.withTag('nuxi')

    if (!process.send && !isTest) {
      logger.warn(
        '`nuxi _dev` is an internal command and should not be used directly. Please use `nuxi dev` instead.',
      )
    }

    // Prepare
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    // Get host info
    const devProxyOptions: DevChildContext =
      JSON.parse(process.env.__NUXT_DEV_PROXY__ || 'null') || {}

    // Init Nuxt dev
    const nuxtDev = await createNuxtDevServer({
      cwd,
      overrides: ctx.data?.overrides,
      logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      clear: !!ctx.args.clear,
      dotenv: !!ctx.args.dotenv,
      https: devProxyOptions.https,
      port: process.env._PORT ?? undefined,
    })

    // IPC Hooks
    function sendIPCMessage<T extends NuxtDevIPCMessage>(message: T) {
      if (process.send) {
        process.send(message)
      } else {
        logger.info(
          'Dev server event:',
          Object.entries(message)
            .map((e) => e[0] + '=' + JSON.stringify(e[1]))
            .join(' '),
        )
      }
    }
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
