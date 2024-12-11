import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'pathe'
import { setupDotenv } from 'c12'
import type { ParsedArgs } from 'citty'
import { defineCommand } from 'citty'
import { isBun, isTest } from 'std-env'
import {
  getArgs as getListhenArgs,
  parseArgs as parseListhenArgs,
} from 'listhen/cli'
import type { HTTPSOptions, ListenOptions } from 'listhen'
import type { NuxtOptions } from '@nuxt/schema'
import { showVersions } from '../utils/banner'
import { loadKit } from '../utils/kit'
import { importModule } from '../utils/esm'
import { overrideEnv } from '../utils/env'
import type { NuxtDevContext, NuxtDevIPCMessage } from '../utils/dev'
import { envNameArgs, legacyRootDirArgs, dotEnvArgs, cwdArgs, logLevelArgs } from './_shared'

const forkSupported = !isBun && !isTest

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
    showVersions(cwd)
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
      await _startSubprocess(devProxy, ctx.rawArgs)
      return { listener: devProxy?.listener }
    }
    else {
      // Directly start Nuxt dev
      const { createNuxtDevServer } = await import('../utils/dev')
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

async function _createDevProxy(
  nuxtOptions: NuxtOptions,
  listenOptions: Partial<ListenOptions>,
) {
  let loadingMessage = 'Nuxt dev server is starting...'
  const loadingTemplate
    = nuxtOptions.devServer.loadingTemplate
    ?? (await importModule('@nuxt/ui-templates', nuxtOptions.modulesDir).then(
      r => r.loading,
    ))

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

async function _startSubprocess(devProxy: DevProxy, rawArgs: string[]) {
  let childProc: ChildProcess | undefined

  const kill = (signal: NodeJS.Signals | number) => {
    if (childProc) {
      childProc.kill(signal)
      childProc = undefined
    }
  }

  const restart = async () => {
    // Kill previous process with restart signal
    kill('SIGHUP')
    // Start new process
    childProc = fork(globalThis.__nuxt_cli__!.entry!, ['_dev', ...rawArgs], {
      execArgv: [
        '--enable-source-maps',
        process.argv.find((a: string) => a.includes('--inspect')),
      ].filter(Boolean) as string[],
      env: {
        ...process.env,
        __NUXT_DEV__: JSON.stringify({
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
  const _port
    = args.port
    ?? args.p
    ?? process.env.NUXT_PORT
    ?? process.env.NITRO_PORT
    ?? process.env.PORT
    ?? nuxtOptions.devServer.port

  const _hostname
    = typeof args.host === 'string'
      ? args.host
      : (args.host === true ? '' : undefined)
        ?? process.env.NUXT_HOST
        ?? process.env.NITRO_HOST
        ?? process.env.HOST
        // TODO: Default host in schema should be undefined instead of ''
        ?? nuxtOptions._layers?.[0]?.config?.devServer?.host
        ?? undefined

  const _public: boolean | undefined
    = args.public
    ?? (_hostname && !['localhost', '127.0.0.1', '::1'].includes(_hostname))
      ? true
      : undefined

  const _httpsCert
    = args['https.cert']
    || (args.sslCert as string)
    || process.env.NUXT_SSL_CERT
    || process.env.NITRO_SSL_CERT
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https?.cert)
    || ''

  const _httpsKey
    = args['https.key']
    || (args.sslKey as string)
    || process.env.NUXT_SSL_KEY
    || process.env.NITRO_SSL_KEY
    || (typeof nuxtOptions.devServer.https !== 'boolean' && nuxtOptions.devServer.https?.key)
    || ''

  const httpsEnabled
    = args.https == true
    || (args.https === undefined && !!nuxtOptions.devServer.https)

  const _listhenOptions = parseListhenArgs({
    ...args,
    'open': (args.o as boolean) || args.open,
    'https': httpsEnabled,
    'https.cert': _httpsCert,
    'https.key': _httpsKey,
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
