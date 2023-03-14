import type { RequestListener } from 'node:http'
import { ChildProcess, fork } from 'node:child_process'
import { resolve } from 'pathe'
import { createProxy } from 'http-proxy'
import { withTrailingSlash } from 'ufo'
import { setupDotenv } from 'c12'
import { showVersions } from '../utils/banner'
import { overrideEnv } from '../utils/env'
import { defineNuxtCommand } from './index'
import { loading as loadingTemplate } from '@nuxt/ui-templates'
import { listen } from 'listhen'
import { fileURLToPath } from 'node:url'

export default defineNuxtCommand({
  meta: {
    name: 'dev',
    description: 'Run nuxt development server',
  },
  args: {
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
    dotenv: {
      type: 'string',
      description: 'Path to .env file',
    },
    clipboard: {
      type: 'boolean',
      description: 'Copy local URL to clipboard',
    },
    open: {
      type: 'boolean',
      alias: 'o',
      description: 'Open local URL in browser',
    },
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on',
    },
    host: {
      type: 'string',
      alias: 'h',
      description: 'Host to listen on',
    },
    https: {
      type: 'boolean',
      description: 'Use HTTPS protocol',
    },
    'ssl-cert': {
      type: 'string',
      description: 'Path to SSL certificate',
    },
    'ssl-key': {
      type: 'string',
      description: 'Path to SSL key',
    },
  },
  async run({ args }) {
    const rootDir = resolve(args._[0] || '.')
    await setupDotenv({ cwd: rootDir, fileName: args.dotenv as string })
    overrideEnv('development')

    showVersions(rootDir)

    let loadingStatus = 'initializing...'
    const loadingHandler: RequestListener = async (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8')
      res.statusCode = 503 // Service Unavailable
      res.end(loadingTemplate({ loading: loadingStatus }))
    }

    let url: string
    const proxy = createProxy({})
    const requestHandler: RequestListener = async (req, res) => {
      if (url) {
        return proxy.web(req, res, { target: url })
      } else {
        return loadingHandler(req, res)
      }
    }

    const listener = await listen(requestHandler, {
      showURL: false,
      clipboard: args.clipboard as boolean,
      open: (args.open || args.o) as boolean,
      port: ((args.port || args.p) as string) || process.env.NUXT_PORT,
      hostname: ((args.host || args.h) as string) || process.env.NUXT_HOST,
      https: (args.https as boolean) && {
        cert: args['ssl-cert'] as string,
        key: args['ssl-key'] as string,
      },
    })

    const address = listener.server.address() as any
    process.env._DEV_SERVER_LISTENER_ = JSON.stringify({
      url: withTrailingSlash(listener.url),
      port: address.port,
      https: listener.https,
    })

    listener.showURL({
      baseURL: withTrailingSlash('/' /* todo: base */),
    })

    process.env._CLI_ARGS_ = JSON.stringify(args)
    const childEntry = fileURLToPath(
      new URL('../dist/dev.mjs', (process as any)._cliEntry)
    )

    let currentProcess: ChildProcess
    const startDevProcess = () => {
      if (currentProcess) {
        currentProcess.kill(0)
      }
      currentProcess = fork(childEntry, {})
      currentProcess.on('message', (message: any) => {
        const type = message?.type as string
        if (!type || !type.startsWith('nuxt:')) {
          return
        }
        if (type === 'nuxt:listen') {
          url = message.url as string
        } else if (type === 'nuxt:loading') {
          loadingStatus = message.status as string
        } else if (type === 'nuxt:restart') {
          startDevProcess()
        }
      })
      currentProcess.on('exit', (code) => {
        console.log(`Dev process exited with code ${code || 0}`)
        if (code !== 0) {
          startDevProcess()
        }
      })
    }

    startDevProcess()

    process.on('SIGHUP', () => {
      startDevProcess()
    })

    return 'wait' as const
  },
})
