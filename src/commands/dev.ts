import type { AddressInfo } from 'node:net'
import type { RequestListener } from 'node:http'
import { relative, resolve } from 'pathe'
import chokidar from 'chokidar'
import { debounce } from 'perfect-debounce'
import type { Nuxt } from '@nuxt/schema'
import { consola } from 'consola'
import { withTrailingSlash } from 'ufo'
import { setupDotenv } from 'c12'
import { showBanner, showVersions } from '../utils/banner'
import { writeTypes } from '../utils/prepare'
import { loadKit } from '../utils/kit'
import { importModule } from '../utils/esm'
import { overrideEnv } from '../utils/env'
import { loadNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { clearBuildDir } from '../utils/fs'
import { defineCommand } from 'citty'

import { sharedArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'dev',
    description: 'Run nuxt development server',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    dotenv: {
      type: 'string',
      description: 'Path to .env file',
    },
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
    },
    clipboard: {
      type: 'boolean',
      description: 'Copy server URL to clipboard',
    },
    open: {
      type: 'boolean',
      description: 'Open server URL in browser',
      alias: 'o',
    },
    port: {
      type: 'string',
      description: 'Port to listen on',
      alias: 'p',
    },
    host: {
      type: 'string',
      description: 'Host to listen on',
      alias: 'h',
    },
    https: {
      type: 'boolean',
      description: 'Enable HTTPS',
    },
    sslCert: {
      type: 'string',
      description: 'Path to SSL certificate',
    },
    sslKey: {
      type: 'string',
      description: 'Path to SSL key',
    },
  },
  async run(ctx) {
    overrideEnv('development')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    showVersions(cwd)

    await setupDotenv({ cwd, fileName: ctx.args.dotenv })

    const { loadNuxt, loadNuxtConfig, buildNuxt } = await loadKit(cwd)

    const config = await loadNuxtConfig({
      cwd,
      overrides: {
        dev: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        ...ctx.data?.overrides,
      },
    })

    const { listen } = await import('listhen')
    const { toNodeListener } = await import('h3')
    let currentHandler: RequestListener | undefined
    let loadingMessage = 'Nuxt is starting...'
    const loadingHandler: RequestListener = async (_req, res) => {
      const { loading: loadingTemplate } = await importModule(
        '@nuxt/ui-templates',
        config.modulesDir,
      )
      res.setHeader('Content-Type', 'text/html; charset=UTF-8')
      res.statusCode = 503 // Service Unavailable
      res.end(loadingTemplate({ loading: loadingMessage }))
    }
    const serverHandler: RequestListener = (req, res) => {
      return currentHandler
        ? currentHandler(req, res)
        : loadingHandler(req, res)
    }

    const listener = await listen(serverHandler, {
      showURL: false,
      clipboard: ctx.args.clipboard,
      open: ctx.args.open,
      port:
        ctx.args.port ||
        process.env.NUXT_PORT ||
        process.env.NITRO_PORT ||
        config.devServer.port,
      hostname:
        ctx.args.host ||
        process.env.NUXT_HOST ||
        process.env.NITRO_HOST ||
        config.devServer.host,
      https:
        ctx.args.https !== false && (ctx.args.https || config.devServer.https)
          ? {
              cert:
                ctx.args.sslCert ||
                process.env.NUXT_SSL_CERT ||
                process.env.NITRO_SSL_CERT ||
                (typeof config.devServer.https !== 'boolean' &&
                  config.devServer.https.cert) ||
                '',
              key:
                ctx.args.sslKey ||
                process.env.NUXT_SSL_KEY ||
                process.env.NITRO_SSL_KEY ||
                (typeof config.devServer.https !== 'boolean' &&
                  config.devServer.https.key) ||
                '',
            }
          : false,
    })

    let currentNuxt: Nuxt
    let distWatcher: chokidar.FSWatcher

    const showURL = () => {
      listener.showURL({
        // TODO: Normalize URL with trailing slash within schema
        baseURL: withTrailingSlash(currentNuxt?.options.app.baseURL) || '/',
      })
    }
    async function hardRestart(reason?: string) {
      if (process.send) {
        await listener.close().catch(() => {})
        await currentNuxt.close().catch(() => {})
        await watcher.close().catch(() => {})
        await distWatcher.close().catch(() => {})
        if (reason) {
          consola.info(`${reason ? reason + '. ' : ''}Restarting nuxt...`)
        }
        process.send({ type: 'nuxt:restart' })
      } else {
        await load(true, reason)
      }
    }
    const load = async (isRestart: boolean, reason?: string) => {
      try {
        loadingMessage = `${reason ? reason + '. ' : ''}${
          isRestart ? 'Restarting' : 'Starting'
        } nuxt...`
        currentHandler = undefined
        if (isRestart) {
          consola.info(loadingMessage)
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

        if (!isRestart) {
          showURL()
        }

        // Write manifest and also check if we need cache invalidation
        if (!isRestart) {
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

        distWatcher = chokidar.watch(
          resolve(currentNuxt.options.buildDir, 'dist'),
          { ignoreInitial: true, depth: 0 },
        )
        distWatcher.on('unlinkDir', () => {
          dLoad(true, '.nuxt/dist directory has been removed')
        })

        const unsub = currentNuxt.hooks.hook('restart', async (options) => {
          unsub() // we use this instead of `hookOnce` for Nuxt Bridge support
          if (options?.hard) {
            return hardRestart()
          }
          await load(true)
        })

        await currentNuxt.hooks.callHook('listen', listener.server, listener)
        const address = (listener.server.address() || {}) as AddressInfo
        currentNuxt.options.devServer.url = listener.url
        currentNuxt.options.devServer.port = address.port
        currentNuxt.options.devServer.host = address.address
        currentNuxt.options.devServer.https = listener.https

        await Promise.all([
          writeTypes(currentNuxt).catch(console.error),
          buildNuxt(currentNuxt),
        ])
        currentHandler = toNodeListener(currentNuxt.server.app)
        if (isRestart && ctx.args.clear !== false) {
          showBanner()
          showURL()
        }
      } catch (err) {
        consola.error(`Cannot ${isRestart ? 'restart' : 'start'} nuxt: `, err)
        currentHandler = undefined
        loadingMessage =
          'Error while loading nuxt. Please check console and fix errors.'
      }
    }

    // Watch for config changes
    // TODO: Watcher service, modules, and requireTree
    const dLoad = debounce(load)
    const watcher = chokidar.watch([cwd], { ignoreInitial: true, depth: 0 })
    watcher.on('all', (_event, _file) => {
      const file = relative(cwd, _file)
      if (file === (ctx.args.dotenv || '.env')) {
        return hardRestart('.env updated')
      }
      if (RESTART_RE.test(file)) {
        dLoad(true, `${file} updated`)
      }
    })

    await load(false)

    return 'wait' as const
  },
})

const RESTART_RE = /^(nuxt\.config\.(js|ts|mjs|cjs)|\.nuxtignore|\.nuxtrc)$/
