import type { NuxtOptions } from '@nuxt/schema'
import type { ParsedArgs } from 'citty'
import type { ChildProcess } from 'node:child_process'
import type { DevAddress } from '../dev/fetch'
import type { HTTPSOptions, ListenOptions, NuxtDevContext, NuxtDevIPCMessage } from '../dev/utils'

import { fork } from 'node:child_process'
import process from 'node:process'

import { defineCommand } from 'citty'
import { isSocketSupported } from 'get-port-please'
import { resolve } from 'pathe'
import { satisfies } from 'semver'
import { FastURL, serve } from 'srvx'
import { isBun, isDeno, isTest } from 'std-env'

import { Youch } from 'youch'
import { initialize } from '../dev'
import { fetchAddress } from '../dev/fetch'
import { isSocketURL, parseSocketURL } from '../dev/socket'
import { resolveLoadingTemplate } from '../dev/utils'
import { connectToChildNetwork, connectToChildSocket } from '../dev/websocket'
import { showVersionsFromConfig } from '../utils/banner'
import { overrideEnv } from '../utils/env'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

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
    'open': {
      type: 'boolean',
      alias: ['o'],
      default: false,
      description: 'Open browser on startup',
    },
    'host': {
      type: 'string',
      alias: ['h'],
      description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST || nuxtOptions.devServer?.host`)',
    },
    'https': {
      type: 'boolean',
      description: 'Enable HTTPS',
    },
    'https.key': {
      type: 'string',
      description: 'Path to HTTPS key file',
    },
    'https.cert': {
      type: 'string',
      description: 'Path to HTTPS certificate file',
    },
    'https.passphrase': {
      type: 'string',
      description: 'Passphrase for HTTPS key file',
    },
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
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    // Load Nuxt Config
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({
      cwd,
      dotenv: { cwd, fileName: ctx.args.dotenv },
      envName: ctx.args.envName, // c12 will fall back to NODE_ENV
      overrides: {
        dev: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        ...(ctx.args.extends && { extends: ctx.args.extends }),
        ...ctx.data?.overrides,
      },
    })

    showVersionsFromConfig(cwd, nuxtOptions)

    const listenOptions = resolveListenOptions(nuxtOptions, ctx.args)
    if (!ctx.args.fork) {
      // Directly start Nuxt dev
      const { listener, close } = await initialize({
        cwd,
        args: ctx.args,
        hostname: listenOptions.hostname,
        public: listenOptions.public,
        publicURLs: undefined,
        proxy: {
          https: listenOptions.https,
        },
      }, { data: ctx.data }, listenOptions)

      return {
        listener,
        async close() {
          await close()
          await listener.close()
        },
      }
    }

    // Start listener
    const devHandler = await createDevHandler(cwd, nuxtOptions, listenOptions)

    const nuxtSocketEnv = process.env.NUXT_SOCKET ? process.env.NUXT_SOCKET === '1' : undefined

    const useSocket = nuxtSocketEnv ?? (nuxtOptions._majorVersion === 4 && await isSocketSupported())

    const urls = await devHandler.listener.getURLs()
    // run initially in in no-fork mode
    const { onRestart, onReady, close } = await initialize({
      cwd,
      args: ctx.args,
      hostname: listenOptions.hostname,
      public: listenOptions.public,
      publicURLs: urls.map(r => r.url),
      proxy: {
        url: devHandler.listener.url,
        urls,
        https: devHandler.listener.https,
        addr: devHandler.listener.address,
      },
      // if running with nuxt v4 or `NUXT_SOCKET=1`, we use the socket listener
      // otherwise pass 'true' to listen on a random port instead
    }, {}, useSocket ? undefined : true)

    onReady(address => devHandler.setAddress(address))

    // ... then fall back to pre-warmed fork if a hard restart is required
    const fork = startSubprocess(cwd, ctx.args, ctx.rawArgs, listenOptions)
    onRestart(async (devServer) => {
      const [subprocess] = await Promise.all([
        fork,
        devServer.close().catch(() => {}),
      ])
      await subprocess.initialize(devHandler, useSocket)
    })

    return {
      listener: devHandler.listener,
      async close() {
        await close()
        const subprocess = await fork
        subprocess.kill(0)
        await devHandler.listener.close()
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

type DevHandler = Awaited<ReturnType<typeof createDevHandler>>

/**
 * Parse address string to DevAddress format
 */
function parseAddress(address: string): DevAddress | undefined {
  if (isSocketURL(address)) {
    const { socketPath } = parseSocketURL(address)
    return { socketPath }
  }

  try {
    const url = new FastURL(address)
    return {
      host: url.hostname,
      port: Number.parseInt(url.port) || 80,
    }
  }
  catch {
    return undefined
  }
}

async function renderErrorResponse(request: Request, error: unknown) {
  const youch = new Youch()
  const errorHtml = await youch.toHTML(error, {
    request: {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    },
  })
  return new Response(errorHtml, {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
  })
}

async function createDevHandler(cwd: string, nuxtOptions: NuxtOptions, listenOptions: Partial<ListenOptions>) {
  let loadingMessage = 'Nuxt dev server is starting...'
  let error: Error | undefined
  let address: string | undefined

  let loadingTemplate = nuxtOptions.devServer.loadingTemplate

  const fetchHandler = async (request: Request): Promise<Response> => {
    try {
      if (error) {
        return renderErrorResponse(request, error)
      }

      // Check for loading state
      if (!address) {
        if (!loadingTemplate) {
          loadingTemplate = await resolveLoadingTemplate(cwd)
        }
        return new Response(loadingTemplate({ loading: loadingMessage }), {
          status: 503,
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store',
          },
        })
      }

      // Parse and forward request to dev server
      const devAddress = parseAddress(address)
      if (!devAddress) {
        throw new Error(`Invalid address: ${address}`)
      }
      return await fetchAddress(devAddress, request)
    }
    catch (error) {
      return renderErrorResponse(request, error)
    }
  }

  const server = serve({
    fetch: fetchHandler,
    port: listenOptions.port,
    hostname: listenOptions.hostname,
    protocol: listenOptions.https ? 'https' : 'http',
    tls: listenOptions.https && typeof listenOptions.https === 'object'
      ? {
          cert: listenOptions.https.cert,
          key: listenOptions.https.key,
          passphrase: listenOptions.https.passphrase,
        }
      : undefined,
  })

  await server.ready()

  const serverAddress = server.node?.server?.address()
  const url = server.url || ''

  const listener = {
    server: server.node?.server,
    url,
    https: listenOptions.https,
    address: typeof serverAddress === 'string' ? { socketPath: serverAddress } : serverAddress || { address: 'localhost', port: Number(listenOptions.port) || 3000, family: 'IPv4' },
    async close() {
      await server.close()
    },
    async getURLs() {
      return [{ url, https: !!listenOptions.https }]
    },
  }

  listener.server?.on('upgrade', (req: any, socket: any, head: any) => {
    if (!address) {
      if (!socket.destroyed) {
        socket.end()
      }
      return
    }

    const devAddress = parseAddress(address)
    if (!devAddress) {
      if (!socket.destroyed) {
        socket.end()
      }
      return
    }

    if (devAddress.socketPath) {
      connectToChildSocket(devAddress.socketPath, req, socket, head)
    }
    else if (devAddress.host && devAddress.port) {
      connectToChildNetwork(devAddress.host, devAddress.port, req, socket, head)
    }
    else {
      if (!socket.destroyed) {
        socket.end()
      }
    }
  })

  return {
    listener,
    setAddress: (_addr: string | undefined) => {
      address = _addr
    },
    setLoadingMessage: (_msg: string) => {
      loadingMessage = _msg
    },
    setError: (_error: Error) => {
      error = _error
    },
    clearError() {
      error = undefined
    },
  }
}

async function startSubprocess(cwd: string, args: { logLevel: string, clear: boolean, dotenv: string, envName: string, extends?: string }, rawArgs: string[], listenOptions: Partial<ListenOptions>) {
  let childProc: ChildProcess | undefined
  let devHandler: DevHandler
  let ready: Promise<void> | undefined
  const kill = (signal: NodeJS.Signals | number) => {
    if (childProc) {
      childProc.kill(signal === 0 && isDeno ? 'SIGTERM' : signal)
      childProc = undefined
    }
  }

  async function initialize(handler: DevHandler, socket: boolean) {
    devHandler = handler
    const urls = await devHandler.listener.getURLs()
    await ready
    childProc!.send({
      type: 'nuxt:internal:dev:context',
      socket,
      context: {
        cwd,
        args,
        hostname: listenOptions.hostname,
        public: listenOptions.public,
        publicURLs: urls.map(r => r.url),
        proxy: {
          url: devHandler.listener.url,
          urls,
          https: devHandler.listener.https,
        },
      } satisfies NuxtDevContext,
    })
  }

  async function restart() {
    devHandler?.clearError()
    // Kill previous process with restart signal (not supported on Windows)
    if (process.platform === 'win32') {
      kill('SIGTERM')
    }
    else {
      kill('SIGHUP')
    }
    // Start new process
    childProc = fork(globalThis.__nuxt_cli__.devEntry!, rawArgs, {
      execArgv: ['--enable-source-maps', process.argv.find((a: string) => a.includes('--inspect'))].filter(Boolean) as string[],
      env: {
        ...process.env,
        __NUXT__FORK: 'true',
      },
    })

    // Close main process on child exit with error
    childProc.on('close', (errorCode) => {
      if (errorCode) {
        process.exit(errorCode)
      }
    })

    // Listen for IPC messages
    ready = new Promise((resolve, reject) => {
      childProc!.on('error', reject)
      childProc!.on('message', (message: NuxtDevIPCMessage) => {
        if (message.type === 'nuxt:internal:dev:fork-ready') {
          resolve()
        }
        else if (message.type === 'nuxt:internal:dev:ready') {
          devHandler.setAddress(message.address)
          if (startTime) {
            logger.debug(`Dev server ready for connections in ${Date.now() - startTime}ms`)
          }
        }
        else if (message.type === 'nuxt:internal:dev:loading') {
          devHandler.setAddress(undefined)
          devHandler.setLoadingMessage(message.message)
          devHandler.clearError()
        }
        else if (message.type === 'nuxt:internal:dev:loading:error') {
          devHandler.setAddress(undefined)
          devHandler.setError(message.error)
        }
        else if (message.type === 'nuxt:internal:dev:restart') {
          restart()
        }
        else if (message.type === 'nuxt:internal:dev:rejection') {
          logger.info(`Restarting Nuxt due to error: \`${message.message}\``)
          restart()
        }
      })
    })
  }

  // Graceful shutdown
  for (const signal of [
    'exit',
    'SIGTERM' /* Graceful shutdown */,
    'SIGINT' /* Ctrl-C */,
    'SIGQUIT' /* Ctrl-\ */,
  ] as const) {
    process.once(signal, () => {
      kill(signal === 'exit' ? 0 : signal)
    })
  }

  await restart()

  return {
    initialize,
    restart,
    kill,
  }
}

function resolveListenOptions(
  nuxtOptions: { devServer: NuxtOptions['devServer'], app: NuxtOptions['app'] },
  args: ParsedArgs<ArgsT>,
): Partial<ListenOptions> {
  const _port = args.port
    ?? args.p
    ?? process.env.NUXT_PORT
    ?? process.env.NITRO_PORT
    ?? process.env.PORT
    ?? nuxtOptions.devServer.port

  const _hostname = typeof args.host === 'string'
    ? args.host
    : args.host === true
      ? ''
      : process.env.NUXT_HOST
        ?? process.env.NITRO_HOST
        ?? process.env.HOST
        ?? (nuxtOptions.devServer?.host || undefined /* for backwards compatibility with previous '' default */)
        ?? undefined

  const _public: boolean | undefined = args.public
    ?? (_hostname && !['localhost', '127.0.0.1', '::1'].includes(_hostname))
    ? true
    : undefined

  const _httpsCert = args['https.cert']
    || (args.sslCert as string)
    || process.env.NUXT_SSL_CERT
    || process.env.NITRO_SSL_CERT
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https && 'cert' in nuxtOptions.devServer.https && nuxtOptions.devServer.https.cert)
    || ''

  const _httpsKey = args['https.key']
    || (args.sslKey as string)
    || process.env.NUXT_SSL_KEY
    || process.env.NITRO_SSL_KEY
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https && 'key' in nuxtOptions.devServer.https && nuxtOptions.devServer.https.key)
    || ''

  const _httpsPfx = args['https.pfx']
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https && 'pfx' in nuxtOptions.devServer.https && nuxtOptions.devServer.https.pfx)
    || ''

  const _httpsPassphrase = args['https.passphrase']
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https && 'passphrase' in nuxtOptions.devServer.https && nuxtOptions.devServer.https.passphrase)
    || ''

  const httpsEnabled = !!(args.https ?? nuxtOptions.devServer.https)

  const httpsOptions: HTTPSOptions | boolean | undefined = httpsEnabled
    ? {
        ...(nuxtOptions.devServer.https as HTTPSOptions),
        cert: _httpsCert,
        key: _httpsKey,
        pfx: _httpsPfx as string | undefined,
        passphrase: _httpsPassphrase,
      }
    : undefined

  return {
    port: _port,
    hostname: _hostname,
    public: _public,
    https: httpsOptions,
    showURL: true,
    open: (args.o as boolean) || args.open,
    baseURL: nuxtOptions.app.baseURL.startsWith('./') ? nuxtOptions.app.baseURL.slice(1) : nuxtOptions.app.baseURL,
  }
}

function isBunForkSupported() {
  const bunVersion: string = (globalThis as any).Bun.version
  return satisfies(bunVersion, '>=1.2')
}
