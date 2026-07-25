import type { ParsedArgs } from 'citty'
import type { HTTPSOptions } from '../dev/cert'
import type { DevListenOverrides } from '../dev/listen'
import type { NuxtDevContext } from '../dev/utils'

import process from 'node:process'

import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import colors from 'picocolors'
import { isBun, isTest } from 'std-env'
import { satisfies } from 'verkit'

import { initialize } from '../dev'
import { closeInspector, openInspector, resolveInspectOptions } from '../dev/inspect'
import { ForkPool } from '../dev/pool'
import { setupShortcuts } from '../dev/shortcuts'
import { debug, logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs, profileArgs } from './_shared'

const startTime: number | undefined = Date.now()
const forkSupported = !isTest && (!isBun || isBunForkSupported())

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
    'inspect': {
      type: 'boolean',
      description: 'Enable the Node.js inspector for the process serving your app (`--inspect=[host:]port`)',
    },
    'inspect-brk': {
      type: 'boolean',
      description: 'Enable the Node.js inspector and wait for a debugger to attach (`--inspect-brk=[host:]port`)',
    },
    'clear': {
      type: 'boolean',
      description: 'Clear console on restart',
      default: false,
    },
    'fork': {
      type: 'boolean',
      description: forkSupported ? 'Disable forked mode' : 'Enable forked mode',
      negativeDescription: 'Disable forked mode',
      default: forkSupported,
      alias: ['f'],
    },
    'port': {
      type: 'string',
      description: 'Port to listen on (default: `NUXT_PORT || NITRO_PORT || PORT || nuxtOptions.devServer.port`)',
      alias: ['p'],
    },
    'strictPort': {
      type: 'boolean',
      description: 'Exit if the requested port is unavailable instead of using another one',
      default: false,
    },
    'host': {
      type: 'string',
      description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST || nuxtOptions.devServer?.host`)',
      alias: ['h'],
    },
    'open': {
      type: 'boolean',
      description: 'Open the URL in the browser',
      alias: ['o'],
      default: false,
    },
    'open.url': {
      type: 'string',
      description: 'Path or URL to open instead of the dev server root',
    },
    'clipboard': {
      type: 'boolean',
      description: 'Copy the URL to the clipboard',
      default: false,
    },
    'qr': {
      type: 'boolean',
      description: 'Print a QR code for the public URL (enabled by default when one is available)',
    },
    'tunnel': {
      type: 'boolean',
      description: 'Expose the server via a Cloudflare quick tunnel',
    },
    'public': {
      type: 'boolean',
      description: 'Listen on all network interfaces',
    },
    'publicURL': {
      type: 'string',
      description: 'Public URL to display (used for QR code and clipboard)',
    },
    'https': {
      type: 'boolean',
      description: 'Enable HTTPS with a locally-trusted development certificate',
    },
    'https.cert': {
      type: 'string',
      description: 'Path to TLS certificate',
    },
    'https.key': {
      type: 'string',
      description: 'Path to TLS key',
    },
    'https.pfx': {
      type: 'string',
      description: 'Path to PKCS#12 (.p12/.pfx) keystore',
    },
    'https.passphrase': {
      type: 'string',
      description: 'Passphrase for the TLS key or keystore',
    },
    'https.validityDays': {
      type: 'string',
      description: 'Validity in days for a generated self-signed certificate',
    },
    'https.domains': {
      type: 'string',
      description: 'Comma-separated domains for a generated certificate',
    },
    ...profileArgs,
    'sslCert': {
      type: 'string',
      description: '(DEPRECATED) Use `--https.cert` instead.',
    },
    'sslKey': {
      type: 'string',
      description: '(DEPRECATED) Use `--https.key` instead.',
    },
  },
  async run(ctx) {
    // Prepare
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const listenOverrides = resolveListenOverrides(ctx.args)

    // The inspector belongs to whichever process is currently serving the app:
    // this one until a hard restart hands over to a fork.
    const inspect = resolveInspectOptions(ctx.rawArgs)
    if (inspect) {
      await openInspector(inspect)
    }

    // Start the initial dev server in-process with listener
    const { listener, close, reload, onRestart, onReady } = await initialize({ cwd, args: ctx.args }, {
      data: ctx.data,
      listenOverrides,
      showBanner: true,
    })

    // Disable forking when profiling to capture all activity in one process
    if (!ctx.args.fork || ctx.args.profile) {
      setupShortcuts({ listener, close, onReady, restart: () => reload('Restart requested') })
      return {
        listener,
        close,
      }
    }

    const pool = new ForkPool({
      rawArgs: ctx.rawArgs,
      poolSize: 2,
      listenOverrides,
      inspect,
    })

    // When ready, start warming up the fork pool
    onReady((_address) => {
      pool.startWarming()
      if (startTime) {
        debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
      }
    })

    // On hard restart, use a fork from the pool
    let cleanupCurrentFork: (() => Promise<void>) | undefined

    async function restartWithFork() {
      // Get a fork from the pool (warm if available, cold otherwise)
      const context: NuxtDevContext = { cwd, args: ctx.args }

      // Release the inspector port before the incoming fork tries to bind it
      await Promise.all([
        cleanupCurrentFork?.(),
        inspect ? closeInspector() : undefined,
      ])

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

    async function restart() {
      // Close the in-process dev server
      await close()
      await restartWithFork()
    }

    onRestart(restart)

    async function closeAll() {
      await cleanupCurrentFork?.()
      await close()
    }

    setupShortcuts({ listener, close: closeAll, onReady, restart })

    return {
      close: closeAll,
    }
  },
})

export default command

// --- Internal ---

type ArgsT = Exclude<
  Awaited<typeof command.args>,
  undefined | ((...args: unknown[]) => unknown)
>

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value)
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    if (value) {
      logger.warn(`Ignoring invalid \`--https.validityDays=${value}\`; expected a positive number of days.`)
    }
    return undefined
  }
  return parsed
}

function resolveListenOverrides(args: ParsedArgs<ArgsT>): DevListenOverrides {
  // _PORT is used by `@nuxt/test-utils` to launch the dev server on a specific port
  if (process.env._PORT) {
    return {
      port: process.env._PORT || 0,
      hostname: '127.0.0.1',
      showURL: false,
    } as const
  }

  const httpsOptions: HTTPSOptions = {
    cert: args['https.cert']
      || args.sslCert
      || process.env.NUXT_SSL_CERT
      || process.env.NITRO_SSL_CERT
      || undefined,
    key: args['https.key']
      || args.sslKey
      || process.env.NUXT_SSL_KEY
      || process.env.NITRO_SSL_KEY
      || undefined,
    pfx: args['https.pfx'] || undefined,
    passphrase: args['https.passphrase'] || undefined,
    validityDays: parsePositiveInteger(args['https.validityDays']),
    domains: args['https.domains']
      ? args['https.domains'].split(',').map(domain => domain.trim()).filter(Boolean)
      : undefined,
  }

  const host = (args.host as string | boolean | undefined)
    ?? (process.env.NUXT_HOST
      || process.env.NITRO_HOST
      || process.env.HOST)

  return {
    port: args.port
      || process.env.NUXT_PORT
      || process.env.NITRO_PORT
      || process.env.PORT
      || undefined,
    strictPort: args.strictPort,
    hostname: host === true || host === '' ? '' : host || undefined,
    open: args.open || !!args['open.url'],
    openURL: args['open.url'] || undefined,
    clipboard: args.clipboard,
    qr: args.qr,
    tunnel: args.tunnel,
    public: args.public,
    publicURL: args.publicURL,
    httpsEnabled: args.https,
    https: httpsOptions,
  }
}

function isBunForkSupported() {
  const bunVersion: string = (globalThis as any).Bun.version
  return satisfies(bunVersion, '>=1.2')
}
