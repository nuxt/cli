import { resolve } from 'pathe'
import { setupDotenv } from 'c12'
import { showVersions } from '../utils/banner'
import { loadKit } from '../utils/kit'
import { importModule } from '../utils/esm'
import { overrideEnv } from '../utils/env'
import { defineCommand, ParsedArgs } from 'citty'
import type { ListenOptions } from 'listhen'
import { getArgs, parseArgs } from 'listhen/cli'
import type { NuxtOptions } from '@nuxt/schema'
import { sharedArgs, legacyRootDirArgs } from './_shared'
import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { IncomingMessage, ServerResponse } from 'node:http'
import { NuxtDevIPCMessage } from './dev-internal'

const command = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run nuxt development server',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    ...getArgs(),
    dotenv: {
      type: 'string',
      description: 'Path to .env file',
    },
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
    },
  },
  async run(ctx) {
    // Prepare
    overrideEnv('development')
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')
    showVersions(cwd)
    await setupDotenv({ cwd, fileName: ctx.args.dotenv })

    // Load Nuxt Config
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({
      cwd,
      overrides: {
        dev: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        ...ctx.data?.overrides,
      },
    })

    // Initialize dev server and listen
    const devServer = await _createDevServer(nuxtOptions)
    const { listen } = await import('listhen')
    const listener = await listen(
      devServer.handler,
      _resolveListenOptions(nuxtOptions, ctx.args),
    )
    await listener.showURL()

    // Start actual builder sub process
    _startSubprocess(devServer)
  },
})

export default command

// --- Internal ---

type ArgsT = Exclude<Awaited<typeof command.args>, undefined | Function>

type DevServer = Awaited<ReturnType<typeof _createDevServer>>

async function _createDevServer(nuxtOptions: NuxtOptions) {
  let loadingMessage = 'Nuxt dev server is starting...'
  const loadingTemplate =
    nuxtOptions.devServer.loadingTemplate ??
    (await importModule('@nuxt/ui-templates', nuxtOptions.modulesDir).then(
      (r) => r.loading,
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
    proxy.web(req, res, { target: address })
  }

  return {
    handler,
    setAddress: (_addr: string | undefined) => {
      address = _addr
    },
    setLoadingMessage: (_msg: string) => {
      loadingMessage = _msg
    },
  }
}

function _startSubprocess(devServer: DevServer) {
  let childProc: ChildProcess | undefined

  const close = () => {
    childProc?.kill()
    childProc = undefined
  }

  const restart = () => {
    close()
    _startSubprocess(devServer)
  }

  for (const signal of [
    'exit',
    'SIGTERM' /* Graceful shutdown */,
    'SIGINT' /* Ctrl-C */,
    'SIGQUIT' /* Ctrl-\ */,
  ] as const) {
    process.once(signal, close)
  }

  childProc = fork(
    globalThis.__nuxt_cli__?.entry!,
    ['_dev', ...process.argv.splice(3)],
    {
      execArgv: [
        '--enable-source-maps',
        process.argv.includes('--inspect') && '--inspect',
      ].filter(Boolean) as string[],
    },
  )

  childProc.on('close', (code) => {
    if (code) {
      process.exit(code)
    } else {
      process.exit()
    }
  })

  childProc.on('message', (message: NuxtDevIPCMessage) => {
    if (message.type === 'nuxt:internal:dev:ready') {
      devServer.setAddress(`http://localhost:${message.port}`)
    } else if (message.type === 'nuxt:internal:dev:loading') {
      devServer.setAddress(undefined)
      devServer.setLoadingMessage(message.message)
    }
    if ((message as { type: string })?.type === 'nuxt:restart') {
      restart
    }
  })

  return {
    childProc,
    close,
    restart,
  }
}

function _resolveListenOptions(
  nuxtOptions: NuxtOptions,
  args: ParsedArgs<ArgsT>,
): Partial<ListenOptions> {
  // TODO: Default host in schema should be undefined
  const _devServerConfig =
    (nuxtOptions._layers?.[0].config || nuxtOptions)?.devServer || {}

  const _port =
    args.port ??
    args.p ??
    process.env.NUXT_PORT ??
    process.env.NITRO_PORT ??
    process.env.PORT ??
    _devServerConfig.port

  const _hostname =
    typeof args.host === 'string'
      ? args.host
      : (args.host === true ? '' : undefined) ??
        process.env.NUXT_HOST ??
        process.env.NITRO_HOST ??
        process.env.HOST ??
        _devServerConfig.host

  const _public: boolean | undefined =
    args.public ??
    (_hostname && !['localhost', '127.0.0.1', '::1'].includes(_hostname))
      ? true
      : undefined

  const _httpsCert =
    args['https.cert'] ||
    (args.sslCert as string) ||
    process.env.NUXT_SSL_CERT ||
    process.env.NITRO_SSL_CERT ||
    (typeof _devServerConfig.https !== 'boolean' &&
      _devServerConfig.https?.cert) ||
    ''

  const _httpsKey =
    args['https.key'] ||
    (args.sslKey as string) ||
    process.env.NUXT_SSL_KEY ||
    process.env.NITRO_SSL_KEY ||
    (typeof _devServerConfig.https !== 'boolean' &&
      _devServerConfig.https?.key) ||
    ''

  return {
    ...parseArgs({
      ...args,
      open: args.open ?? args.o,
      'https.cert': _httpsCert,
      'https.key': _httpsKey,
    }),
    port: _port,
    hostname: _hostname,
    public: _public,
    showURL: false,
  }
}
