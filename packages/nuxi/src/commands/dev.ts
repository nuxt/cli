import type { NuxtOptions } from '@nuxt/schema'
import type { ParsedArgs } from 'citty'
import type { HTTPSOptions, ListenOptions } from 'listhen'
import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NuxtDevContext, NuxtDevIPCMessage } from '../utils/dev'

import { fork } from 'node:child_process'
import process from 'node:process'

import { setupDotenv } from 'c12'
import { defineCommand } from 'citty'
import defu from 'defu'
import { createJiti } from 'jiti'
import { getArgs as getListhenArgs, parseArgs as parseListhenArgs } from 'listhen/cli'
import { resolve } from 'pathe'
import { satisfies } from 'semver'

import { isBun, isTest } from 'std-env'
import { showVersions } from '../utils/banner'
import { _getDevServerOverrides } from '../utils/dev'
import { overrideEnv } from '../utils/env'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

const forkSupported = !isTest && (!isBun || isBunForkSupported())

const command = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run Nuxt development server',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...legacyRootDirArgs,
    ...getListhenArgs(),
    ...dotEnvArgs,
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
    },
    fork: {
      type: 'boolean',
      description: forkSupported ? 'Disable forked mode' : 'Enable forked mode',
      default: forkSupported,
    },
  },
  async run(ctx) {
    // Prepare
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    await showVersions(cwd)
    await setupDotenv({ cwd, fileName: ctx.args.dotenv })

    // Load Nuxt Config
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({
      cwd,
      envName: ctx.args.envName, // c12 will fall back to NODE_ENV
      overrides: {
        dev: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        ...ctx.data?.overrides,
      },
    })

    // Start Proxy Listener
    const listenOptions = _resolveListenOptions(nuxtOptions, ctx.args)

    if (ctx.args.fork) {
      // Fork Nuxt dev process
      const devProxy = await _createDevProxy(nuxtOptions, listenOptions)
      await _startSubprocess(devProxy, ctx.rawArgs, listenOptions)
      return { listener: devProxy?.listener }
    }
    else {
      // Directly start Nuxt dev
      const { createNuxtDevServer } = await import('../utils/dev')

      ctx.data ||= {}
      ctx.data.overrides = defu(ctx.data.overrides, _getDevServerOverrides(listenOptions))
      const devServer = await createNuxtDevServer(
        {
          cwd,
          overrides: ctx.data?.overrides,
          logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
          clear: ctx.args.clear,
          dotenv: !!ctx.args.dotenv,
          envName: ctx.args.envName,
          loadingTemplate: nuxtOptions.devServer.loadingTemplate,
          devContext: {},
        },
        listenOptions,
      )
      await devServer.init()
      return { listener: devServer?.listener }
    }
  },
})

export default command

// --- Internal ---

type ArgsT = Exclude<
  Awaited<typeof command.args>,
  undefined | ((...args: unknown[]) => unknown)
>

type DevProxy = Awaited<ReturnType<typeof _createDevProxy>>

async function _createDevProxy(nuxtOptions: NuxtOptions, listenOptions: Partial<ListenOptions>) {
  const jiti = createJiti(nuxtOptions.rootDir)
  let loadingMessage = 'Nuxt dev server is starting...'
  let loadingTemplate = nuxtOptions.devServer.loadingTemplate
  for (const url of nuxtOptions.modulesDir) {
    // @ts-expect-error this is for backwards compatibility
    if (loadingTemplate) {
      break
    }
    loadingTemplate = await jiti.import<{ loading: () => string }>('@nuxt/ui-templates', { parentURL: url }).then(r => r.loading)
  }

  const { createProxyServer } = await import('httpxy')
  const proxy = createProxyServer({})

  let address: string | undefined

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (!address) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'text/html')
      res.end(loadingTemplate({ loading: loadingMessage }))
      return
    }
    return proxy.web(req, res, { target: address })
  }

  const wsHandler = (req: IncomingMessage, socket: any, head: any) => {
    if (!address) {
      socket.destroy()
      return
    }
    return proxy.ws(req, socket, { target: address }, head)
  }

  const { listen } = await import('listhen')
  const listener = await listen(handler, listenOptions)
  listener.server.on('upgrade', wsHandler)

  return {
    listener,
    handler,
    wsHandler,
    setAddress: (_addr: string | undefined) => {
      address = _addr
    },
    setLoadingMessage: (_msg: string) => {
      loadingMessage = _msg
    },
  }
}

async function _startSubprocess(devProxy: DevProxy, rawArgs: string[], listenArgs: Partial<ListenOptions>) {
  let childProc: ChildProcess | undefined

  const kill = (signal: NodeJS.Signals | number) => {
    if (childProc) {
      childProc.kill(signal)
      childProc = undefined
    }
  }

  const restart = async () => {
    // Kill previous process with restart signal (not supported on Windows)
    if (process.platform === 'win32') {
      kill('SIGTERM')
    }
    else {
      kill('SIGHUP')
    }
    // Start new process
    childProc = fork(globalThis.__nuxt_cli__!.entry!, ['_dev', ...rawArgs], {
      execArgv: [
        '--enable-source-maps',
        process.argv.find((a: string) => a.includes('--inspect')),
      ].filter(Boolean) as string[],
      env: {
        ...process.env,
        __NUXT_DEV__: JSON.stringify({
          hostname: listenArgs.hostname,
          public: listenArgs.public,
          proxy: {
            url: devProxy.listener.url,
            urls: await devProxy.listener.getURLs(),
            https: devProxy.listener.https,
          },
        } satisfies NuxtDevContext),
      },
    })

    // Close main process on child exit with error
    childProc.on('close', (errorCode) => {
      if (errorCode) {
        process.exit(errorCode)
      }
    })

    // Listen for IPC messages
    childProc.on('message', (message: NuxtDevIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:ready') {
        devProxy.setAddress(`http://127.0.0.1:${message.port}`)
      }
      else if (message.type === 'nuxt:internal:dev:loading') {
        devProxy.setAddress(undefined)
        devProxy.setLoadingMessage(message.message)
      }
      else if (message.type === 'nuxt:internal:dev:restart') {
        restart()
      }
      else if (message.type === 'nuxt:internal:dev:rejection') {
        logger.withTag('nuxi').info(`Restarting Nuxt due to error: \`${message.message}\``)
        restart()
      }
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
    restart,
    kill,
  }
}

function _resolveListenOptions(
  nuxtOptions: NuxtOptions,
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
    : (args.host === true ? '' : undefined)
      ?? process.env.NUXT_HOST
      ?? process.env.NITRO_HOST
      ?? process.env.HOST
      // TODO: Default host in schema should be undefined instead of ''
      ?? nuxtOptions._layers?.[0]?.config?.devServer?.host
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

  const _listhenOptions = parseListhenArgs({
    ...args,
    'open': (args.o as boolean) || args.open,
    'https': httpsEnabled,
    'https.cert': _httpsCert,
    'https.key': _httpsKey,
    'https.pfx': _httpsPfx,
    'https.passphrase': _httpsPassphrase,
  })

  const httpsOptions = httpsEnabled && {
    ...(nuxtOptions.devServer.https as HTTPSOptions),
    ...(_listhenOptions.https as HTTPSOptions),
  }

  return {
    ..._listhenOptions,
    port: _port,
    hostname: _hostname,
    public: _public,
    https: httpsOptions,
    baseURL: nuxtOptions.app.baseURL.startsWith('./') ? nuxtOptions.app.baseURL.slice(1) : nuxtOptions.app.baseURL,
  }
}

function isBunForkSupported() {
  const bunVersion: string = (globalThis as any).Bun.version
  return satisfies(bunVersion, '>=1.2')
}
