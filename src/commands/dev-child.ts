import { resolve } from 'pathe'
import { consola } from 'consola'
import { overrideEnv } from '../utils/env'
import { defineCommand } from 'citty'
import { sharedArgs, legacyRootDirArgs } from './_shared'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { isTest } from 'std-env'
import { Listener } from 'listhen'
import { NuxtDevIPCMessage, createNuxtDevServer } from '../utils/dev'

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

    // Start internal server
    const server = new Server((req, res) => {
      if (!nuxtDev.handler) {
        // This should not be reached!
        res.statusCode = 503
        res.end('Nuxt is not ready yet!')
        return
      }
      nuxtDev.handler(req, res)
    })

    const _addr = await new Promise<AddressInfo>((resolve) => {
      server.listen(process.env._PORT || 0, () => {
        resolve(server.address() as AddressInfo)
      })
    })
    const serverURL = `http://127.0.0.1:${_addr.port}/`
    if (!process.send) {
      logger.success(`Listening on ${serverURL}`)
    }

    const listenerInfo = JSON.parse(
      process.env.__NUXT_DEV_LISTENER__ || 'null',
    ) || { url: serverURL, urls: [], https: false }
    const listener = {
      // Internal server
      server: server,
      address: _addr,
      // Exposed server
      url: listenerInfo.url,
      https: listenerInfo.https,
      close: () => Promise.reject('Cannot close internal dev server!'),
      open: () => Promise.resolve(),
      showURL: () => Promise.resolve(),
      getURLs: () =>
        Promise.resolve([
          ...listenerInfo.urls,
          { url: serverURL, type: 'local' },
        ]),
    } satisfies Listener

    // Init Nuxt dev
    const nuxtDev = createNuxtDevServer({
      cwd,
      overrides: ctx.data?.overrides,
      logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      clear: !!ctx.args.clear,
      dotenv: !!ctx.args.dotenv,
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
    await nuxtDev.init(listener)
  },
})
