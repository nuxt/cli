import { relative, resolve } from 'pathe'
import chokidar from 'chokidar'
import type { Nuxt } from '@nuxt/schema'
import { consola } from 'consola'
import { debounce } from 'perfect-debounce'
// We are deliberately inlining this code as a backup in case user has `@nuxt/schema<3.7`
import { writeTypes as writeTypesLegacy } from '@nuxt/kit'
import { loadKit } from '../utils/kit'
import { overrideEnv } from '../utils/env'
import { loadNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { clearBuildDir } from '../utils/fs'
import { defineCommand } from 'citty'
import { sharedArgs, legacyRootDirArgs } from './_shared'
import { RequestListener, Server } from 'http'
import { toNodeListener } from 'h3'
import { AddressInfo } from 'net'
import { isTest } from 'std-env'
import { Listener } from 'listhen'

export type NuxtDevIPCMessage =
  | { type: 'nuxt:internal:dev:ready'; port: number }
  | { type: 'nuxt:internal:dev:loading'; message: string }
  | { type: 'nuxt:internal:dev:restart' }

const RESTART_RE = /^(nuxt\.config\.(js|ts|mjs|cjs)|\.nuxtignore|\.nuxtrc)$/

export default defineCommand({
  meta: {
    name: '_dev',
    description: 'Run nuxt development server (internal command)',
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

    // Load nuxt kit
    const {
      loadNuxt,
      buildNuxt,
      writeTypes = writeTypesLegacy,
    } = await loadKit(cwd)

    // Handler
    let serverHandler: undefined | RequestListener
    const server = new Server((req, res) => {
      if (!serverHandler) {
        // This should not be reached!
        res.statusCode = 503
        res.end('Nuxt is not ready yet!')
        return
      }
      serverHandler(req, res)
    })

    const port = await new Promise<number>((resolve) => {
      server.listen(process.env._PORT || 0, () => {
        resolve((server.address() as AddressInfo).port)
      })
    })
    const serverURL = `http://127.0.0.1:${port}/`
    if (!process.send) {
      logger.success(`Listening on ${serverURL}`)
    }

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

    let currentNuxt: Nuxt
    let distWatcher: chokidar.FSWatcher
    async function _load(reload?: boolean, reason?: string) {
      const action = reload ? 'Restarting' : 'Starting'
      const message = `${reason ? reason + '. ' : ''}${action} nuxt...`
      serverHandler = undefined
      sendIPCMessage({
        type: 'nuxt:internal:dev:loading',
        message,
      })
      if (reload) {
        consola.info(message)
      }

      if (currentNuxt) {
        await currentNuxt.close()
      }
      if (distWatcher) {
        await distWatcher.close()
      }

      currentNuxt = await loadNuxt({
        rootDir: cwd,
        dev: true,
        ready: false,
        overrides: {
          logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
          vite: {
            clearScreen: ctx.args.clear,
          },
          ...ctx.data?.overrides,
        },
      })

      // Write manifest and also check if we need cache invalidation
      if (!reload) {
        const previousManifest = await loadNuxtManifest(
          currentNuxt.options.buildDir,
        )
        const newManifest = await writeNuxtManifest(currentNuxt)
        if (
          previousManifest &&
          newManifest &&
          previousManifest._hash !== newManifest._hash
        ) {
          await clearBuildDir(currentNuxt.options.buildDir)
        }
      }

      await currentNuxt.ready()

      const unsub = currentNuxt.hooks.hook('restart', async (options) => {
        unsub() // We use this instead of `hookOnce` for Nuxt Bridge support
        if (options?.hard) {
          sendIPCMessage({ type: 'nuxt:internal:dev:restart' })
          return
        }
        await load(true)
      })

      // Emulate a listener for listen hook
      // Currently it is typed as any in nuxt. we try to keep it close to listhen interface
      const listenerInfo = JSON.parse(
        process.env.__NUXT_DEV_LISTENER__ || 'null',
      ) || { url: serverURL, urls: [], https: false }
      await currentNuxt.hooks.callHook('listen', server, {
        // Internal server
        server,
        address: { host: '127.0.0.1', port },
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
      } satisfies Listener)

      // Sync internal server info to the internals
      // It is important for vite-node to use the internal URL
      currentNuxt.options.devServer.url = `http://127.0.0.1:${port}/`
      currentNuxt.options.devServer.host = '127.0.0.1'
      currentNuxt.options.devServer.port = port
      currentNuxt.options.devServer.https = listenerInfo.https

      await Promise.all([
        writeTypes(currentNuxt).catch(console.error),
        buildNuxt(currentNuxt),
      ])

      // Watch dist directory
      distWatcher = chokidar.watch(
        resolve(currentNuxt.options.buildDir, 'dist'),
        { ignoreInitial: true, depth: 0 },
      )
      distWatcher.on('unlinkDir', () => {
        loadDebounced(true, '.nuxt/dist directory has been removed')
      })

      serverHandler = toNodeListener(currentNuxt.server.app)
      sendIPCMessage({ type: 'nuxt:internal:dev:ready', port })
    }

    async function load(reload?: boolean, reason?: string) {
      try {
        await _load(reload, reason)
      } catch (error) {
        consola.error(`Cannot ${reload ? 'restart' : 'start'} nuxt: `, error)
        serverHandler = undefined
        const message =
          'Error while loading nuxt. Please check console and fix errors.'
        sendIPCMessage({ type: 'nuxt:internal:dev:loading', message })
      }
    }

    const loadDebounced = debounce(load)

    // Watch for config changes
    const configWatcher = chokidar.watch([cwd], {
      ignoreInitial: true,
      depth: 0,
    })
    configWatcher.on('all', (_event, _file) => {
      const file = relative(cwd, _file)
      if (file === (ctx.args.dotenv || '.env')) {
        return sendIPCMessage({ type: 'nuxt:internal:dev:restart' })
      }
      if (RESTART_RE.test(file)) {
        loadDebounced(true, `${file} updated`)
      }
    })

    await load(false)
  },
})
