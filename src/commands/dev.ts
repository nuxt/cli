import type { RequestListener } from 'node:http'
import { ChildProcess, fork } from 'node:child_process'
import { resolve, dirname } from 'pathe'
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
    usage:
      'npx nuxi dev [rootDir] [--dotenv] [--clipboard] [--open, -o] [--port, -p] [--host, -h] [--https] [--ssl-cert] [--ssl-key]',
    description: 'Run nuxt development server',
  },
  async invoke(args) {
    const rootDir = resolve(args._[0] || '.')
    await setupDotenv({ cwd: rootDir, fileName: args.dotenv })
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
      clipboard: args.clipboard,
      open: args.open || args.o,
      port: args.port || args.p || process.env.NUXT_PORT,
      hostname: args.host || args.h || process.env.NUXT_HOST,
      https: args.https && {
        cert: args['ssl-cert'],
        key: args['ssl-key'],
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
