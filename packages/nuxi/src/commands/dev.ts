import type { ParsedArgs } from 'citty'
import type { NuxtDevContext } from '../dev/utils'

import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { getArgs as getListhenArgs, parseArgs as parseListhenArgs } from 'listhen/cli'
import { resolve } from 'pathe'
import { satisfies } from 'semver'
import { isBun, isTest } from 'std-env'

import { initialize } from '../dev'
import { ForkPool } from '../dev/pool'
import { debug, logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

const startTime: number | undefined = Date.now()
const forkSupported = !isTest && (!isBun || isBunForkSupported())
const listhenArgs = getListhenArgs()

const command = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run Nuxt development server',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...legacyRootDirArgs,
    ...envNameArgs,
    ...extendsArgs,
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
      default: false,
    },
    fork: {
      type: 'boolean',
      description: forkSupported ? 'Disable forked mode' : 'Enable forked mode',
      negativeDescription: 'Disable forked mode',
      default: forkSupported,
      alias: ['f'],
    },
    ...{
      ...listhenArgs,
      port: {
        ...listhenArgs.port,
        description: 'Port to listen on (default: `NUXT_PORT || NITRO_PORT || PORT || nuxtOptions.devServer.port`)',
        alias: ['p'],
      },
      open: {
        ...listhenArgs.open,
        alias: ['o'],
        default: false,
      },
      host: {
        ...listhenArgs.host,
        alias: ['h'],
        description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST || nuxtOptions.devServer?.host`)',
      },
      clipboard: { ...listhenArgs.clipboard, default: false },
    },
    sslCert: {
      type: 'string',
      description: '(DEPRECATED) Use `--https.cert` instead.',
    },
    sslKey: {
      type: 'string',
      description: '(DEPRECATED) Use `--https.key` instead.',
    },
  },
  async run(ctx) {
    // Prepare
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const listenOverrides = resolveListenOverrides(ctx.args)

    // Start the initial dev server in-process with listener
    const { listener, close, onRestart, onReady } = await initialize({ cwd, args: ctx.args }, {
      data: ctx.data,
      listenOverrides,
      showBanner: true,
    })

    if (!ctx.args.fork) {
      return {
        listener,
        close,
      }
    }

    const pool = new ForkPool({
      rawArgs: ctx.rawArgs,
      poolSize: 2,
      listenOverrides,
    })

    // When ready, start warming up the fork pool
    onReady((_address) => {
      pool.startWarming()
      if (startTime) {
        debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
      }
    })

    // On hard restart, use a fork from the pool
    let cleanupCurrentFork: (() => void) | undefined

    async function restartWithFork() {
      // Get a fork from the pool (warm if available, cold otherwise)
      const context: NuxtDevContext = { cwd, args: ctx.args }

      // Clean up previous fork if any
      cleanupCurrentFork?.()

      cleanupCurrentFork = await pool.getFork(context, (message) => {
        // Handle IPC messages from the fork
        if (message.type === 'nuxt:internal:dev:ready') {
          if (startTime) {
            debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
          }
        }
        else if (message.type === 'nuxt:internal:dev:restart') {
          // Fork is requesting another restart
          void restartWithFork()
        }
        else if (message.type === 'nuxt:internal:dev:rejection') {
          logger.info(`Restarting Nuxt due to error: ${colors.cyan(message.message)}`)
          void restartWithFork()
        }
      })
    }

    onRestart(async () => {
      // Close the in-process dev server
      await close()
      await restartWithFork()
    })

    return {
      async close() {
        cleanupCurrentFork?.()
        await Promise.all([
          listener.close(),
          close(),
        ])
      },
    }
  },
})

export default command

// --- Internal ---

type ArgsT = Exclude<
  Awaited<typeof command.args>,
  undefined | ((...args: unknown[]) => unknown)
>

function resolveListenOverrides(args: ParsedArgs<ArgsT>) {
  // _PORT is used by `@nuxt/test-utils` to launch the dev server on a specific port
  if (process.env._PORT) {
    return {
      port: process.env._PORT || 0,
      hostname: '127.0.0.1',
      showURL: false,
    } as const
  }

  const options = parseListhenArgs({
    ...args,
    'host': args.host
      || process.env.NUXT_HOST
      || process.env.NITRO_HOST
      || process.env.HOST!,
    'port': args.port
      || process.env.NUXT_PORT
      || process.env.NITRO_PORT
      || process.env.PORT!,
    'https': args.https !== false,
    'https.cert': args['https.cert']
      || args.sslCert
      || process.env.NUXT_SSL_CERT
      || process.env.NITRO_SSL_CERT!,
    'https.key': args['https.key']
      || args.sslKey
      || process.env.NUXT_SSL_KEY
      || process.env.NITRO_SSL_KEY!,
  } as Parameters<typeof parseListhenArgs>[0])

  return {
    ...options,
    // if the https flag is not present, https.xxx arguments are ignored.
    // override if https is enabled in devServer config.
    _https: args.https,
    get https(): typeof options['https'] {
      return this._https ? options.https : false
    },
  } as const
}

function isBunForkSupported() {
  const bunVersion: string = (globalThis as any).Bun.version
  return satisfies(bunVersion, '>=1.2')
}
