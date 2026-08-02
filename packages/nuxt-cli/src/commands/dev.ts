import type { ParsedArgs } from 'citty'
import type { HTTPSOptions } from '../dev/cert'
import type { DevListenOverrides } from '../dev/listen'
import type { ActiveFork } from '../dev/pool'
import type { DevRestartReason } from '../dev/reason'
import type { NuxtDevContext } from '../dev/utils'

import process from 'node:process'

import { defineCommand } from 'citty'
import { resolve } from 'pathe'

import { isBun, isTest } from 'std-env'
import { satisfies } from 'verkit'
import { initialize } from '../dev'

import { closeInspector, openInspector, resolveInspectOptions } from '../dev/inspect'
import { isReusePortSupported } from '../dev/listen'
import { ForkPool } from '../dev/pool'
import { formatRestartReason } from '../dev/reason'
import { setupShortcuts } from '../dev/shortcuts'
import { SUPERVISOR_SHUTDOWN_TIMEOUT_MS } from '../dev/shutdown'
import { formatTakeoverRefusal, takeOverDevServer } from '../dev/takeover'
import { summariseActiveResources } from '../utils/hang'
import { debug, logger } from '../utils/logger'
import { resolveRootDir } from '../utils/paths'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, profileArgs, rootDirArgs } from './_shared'

const startTime: number | undefined = Date.now()

const SHUTDOWN_NOTICE_MS = 1500
const forkSupported = !isTest && (!isBun || isBunForkSupported())

const command = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run Nuxt development server',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
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
    'takeover': {
      type: 'boolean',
      description: 'Stop a dev server already running on this project and take its place',
      negativeDescription: 'Never stop a dev server already running on this project',
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
    const cwd = resolveRootDir(ctx.args)

    const listenOverrides = resolveListenOverrides(ctx.args)

    const takeover = await takeOverDevServer(resolveDevBuildDir(cwd), {
      requestedPort: parseRequestedPort(listenOverrides.port),
      takeover: ctx.args.takeover,
    })
    if (takeover.action === 'refused') {
      logger.error(formatTakeoverRefusal(takeover.existing, takeover.reason))
      process.exit(1)
    }
    if (takeover.action === 'start-anyway') {
      process.env.NUXT_IGNORE_LOCK = '1'
    }
    if (takeover.action === 'taken') {
      listenOverrides.port = takeover.port
    }

    // With `SO_REUSEPORT` an incoming fork can bind the port before this process
    // releases it, so a hard restart never leaves the port unserved.
    const reusePort = ctx.args.fork && !ctx.args.profile && await isReusePortSupported()
    listenOverrides.reusePort = reusePort

    // The inspector belongs to whichever process is currently serving the app:
    // this one until a hard restart hands over to a fork.
    const inspect = resolveInspectOptions(ctx.rawArgs)
    if (inspect) {
      await openInspector(inspect)
    }

    // Start the initial dev server in-process with listener
    const { listener, close, reload, onRestart, onReady, onFileChange } = await initialize({ cwd, args: ctx.args, handoverFrom: takeover.action === 'taken' ? takeover.pid : undefined }, {
      data: ctx.data,
      listenOverrides,
      showBanner: true,
    })

    // Disable forking when profiling to capture all activity in one process
    if (!ctx.args.fork || ctx.args.profile) {
      setupShortcuts({ listener, close, onReady, restart: () => reload({ type: 'shortcut' }) })
      setupSignalHandlers(close)
      return {
        listener,
        close,
      }
    }

    const pool = new ForkPool({
      rawArgs: ctx.rawArgs,
      poolSize: resolveForkPoolSize(),
      listenOverrides,
      inspect,
    })

    onReady((_address) => {
      if (startTime) {
        debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
      }
    })

    // Warming costs a whole extra Node process, so wait until the user shows
    // signs of editing the project rather than paying for it on every `nuxt dev`.
    onFileChange(() => {
      pool.startWarming()
    })

    // On hard restart, use a fork from the pool
    // Whatever is serving the app right now: this process, then each fork in turn.
    let closeCurrent = close
    let currentPid = process.pid

    // A hard restart can be asked for from several places at once (the config
    // watcher, the `r` shortcut, and the fork that is currently serving), and two
    // overlapping handovers would both bind the port and then race over which one
    // is recorded as current.
    let inFlight: Promise<void> | undefined
    let pendingReason: { reason?: DevRestartReason } | undefined

    function restartWithFork(reason?: DevRestartReason): Promise<void> {
      if (inFlight) {
        pendingReason = { reason }
        return inFlight
      }
      inFlight = replaceWithFork(reason).finally(() => {
        inFlight = undefined
        const pending = pendingReason
        pendingReason = undefined
        if (pending) {
          void restartWithFork(pending.reason)
        }
      })
      return inFlight
    }

    async function replaceWithFork(reason?: DevRestartReason) {
      logger.info(formatRestartReason(reason, { rootDir: cwd, hard: true }))

      // The inspector port cannot be shared, so the handover has to stay
      // serialised whenever the inspector is open.
      const handover = reusePort && !inspect

      // Get a fork from the pool (warm if available, cold otherwise)
      const context: NuxtDevContext = {
        cwd,
        args: ctx.args,
        handoverFrom: handover ? currentPid : undefined,
      }

      if (!handover) {
        await Promise.all([
          closeCurrent(),
          inspect ? closeInspector() : undefined,
        ])
      }

      let serving = false
      let fork: ActiveFork | undefined
      try {
        fork = await pool.getFork(context, {
          listenOverrides: handover
            ? { port: listener.address.port, handover: true }
            : undefined,
          onMessage: (message) => {
            // Handle IPC messages from the fork
            if (message.type === 'nuxt:internal:dev:ready' || message.type === 'nuxt:internal:dev:loading:error') {
              serving = true
              if (message.type === 'nuxt:internal:dev:ready' && startTime) {
                debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
              }
            }
            else if (!serving) {
              // Failures before the fork serves anything are handled below, which
              // leaves the outgoing server in place.
            }
            else if (message.type === 'nuxt:internal:dev:restart') {
              // Fork is requesting another restart
              void restartWithFork(message.reason)
            }
            else if (message.type === 'nuxt:internal:dev:rejection') {
              void restartWithFork({ type: 'error', message: message.message })
            }
          },
        })
        await fork.serving
      }
      catch (error) {
        await fork?.close()
        const detail = error instanceof Error ? error.message : String(error)
        if (!handover) {
          // The outgoing server is already closed, so there is nothing left to
          // serve the app and no watcher left to trigger another attempt.
          logger.error(`Could not restart the dev server: ${detail}`)
          process.exit(1)
        }
        logger.error(`Could not restart the dev server, keeping the current one: ${detail}`)
        onRestart(restart)
        return
      }

      serving = true
      fork.promote()
      const closePrevious = handover ? closeCurrent : undefined
      closeCurrent = fork.close
      currentPid = fork.pid ?? currentPid
      await closePrevious?.()
    }

    async function restart(reason?: DevRestartReason) {
      await restartWithFork(reason)
    }

    onRestart(restart)

    async function closeAll() {
      if (closeCurrent !== close) {
        await closeCurrent()
      }
      await close()
    }

    setupShortcuts({ listener, close: closeAll, onReady, restart: () => restart({ type: 'shortcut' }) })
    setupSignalHandlers(closeAll)

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

/**
 * Shut the dev server down on `SIGINT`/`SIGTERM`.
 *
 * Registering any listener for these signals (the fork pool and the CPU
 * profiler both do) suppresses Node's default exit behaviour, so Ctrl-C would
 * otherwise leave the server, its forks and any tunnel running.
 *
 * Shutdown is given enough time for `close` hooks (nitro plugins closing database
 * connections, and so on) to finish; a second Ctrl-C skips the wait.
 */
function setupSignalHandlers(close: () => Promise<void>): void {
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (closing) {
        process.exit(130)
      }
      closing = true

      const notice = setTimeout(() => {
        logger.info('Shutting down... press Ctrl-C again to exit immediately.')
      }, SHUTDOWN_NOTICE_MS)
      notice.unref?.()

      // Ctrl-C should always give the terminal back, even if a watcher or an
      // open connection stops the graceful shutdown from settling.
      const deadline = setTimeout(() => {
        const summary = summariseActiveResources()
        logger.warn(`The dev server did not shut down within ${SUPERVISOR_SHUTDOWN_TIMEOUT_MS / 1000}s${summary ? `: ${summary}` : ''}. Exiting anyway.`)
        process.exit()
      }, SUPERVISOR_SHUTDOWN_TIMEOUT_MS)

      close()
        .catch((error) => {
          console.error(error)
          process.exitCode = 1
        })
        .finally(() => {
          clearTimeout(notice)
          clearTimeout(deadline)
          process.exit()
        })
    })
  }
}

/**
 * The lock lives in the build directory, which is only known once `nuxt.config`
 * has been resolved. Resolving it here would mean loading the config twice, so
 * a project with a custom `buildDir` gets the plain lock error instead of the
 * cross-terminal takeover.
 */
function resolveDevBuildDir(cwd: string): string {
  return resolve(cwd, '.nuxt')
}

function parseRequestedPort(port: string | number | undefined): number | undefined {
  const parsed = Number(port)
  return port === undefined || port === '' || !Number.isInteger(parsed) || parsed <= 0 ? undefined : parsed
}

function resolveForkPoolSize(): number | undefined {
  const raw = process.env.NUXT_DEV_FORK_POOL_SIZE
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`Ignoring invalid \`NUXT_DEV_FORK_POOL_SIZE=${raw}\`; expected a non-negative integer.`)
    return undefined
  }
  return parsed
}

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
