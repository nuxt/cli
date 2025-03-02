import type { Nuxt, NuxtConfig } from '@nuxt/schema'
import type { FSWatcher } from 'chokidar'
import type { Jiti } from 'jiti'
import type { HTTPSOptions, Listener, ListenOptions, ListenURL } from 'listhen'
import type { RequestListener, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import EventEmitter from 'node:events'
import process from 'node:process'

import chokidar from 'chokidar'
import defu from 'defu'
import { toNodeListener } from 'h3'
import { createJiti } from 'jiti'
import { listen } from 'listhen'
import { join, relative, resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { joinURL } from 'ufo'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'

export type NuxtDevIPCMessage =
  | { type: 'nuxt:internal:dev:ready', port: number }
  | { type: 'nuxt:internal:dev:loading', message: string }
  | { type: 'nuxt:internal:dev:restart' }
  | { type: 'nuxt:internal:dev:rejection', message: string }

export interface NuxtDevContext {
  public?: boolean
  hostname?: string
  publicURLs?: string[]
  proxy?: {
    url?: string
    urls?: ListenURL[]
    https?: boolean | HTTPSOptions
  }
}

interface NuxtDevServerOptions {
  cwd: string
  logLevel: 'silent' | 'info' | 'verbose'
  dotenv: boolean
  envName: string
  clear: boolean
  overrides: NuxtConfig
  port?: string | number
  loadingTemplate?: ({ loading }: { loading: string }) => string
  devContext: NuxtDevContext
}

export async function createNuxtDevServer(
  options: NuxtDevServerOptions,
  listenOptions?: Partial<ListenOptions>,
) {
  // Initialize dev server
  const devServer = new NuxtDevServer(options)

  // Attach internal listener
  devServer.listener = await listen(
    devServer.handler,
    listenOptions || {
      port: options.port ?? 0,
      hostname: '127.0.0.1',
      showURL: false,
    },
  )

  // Merge interface with public context
  // @ts-expect-error private property
  devServer.listener._url = devServer.listener.url
  if (options.devContext.proxy?.url) {
    devServer.listener.url = options.devContext.proxy.url
  }
  if (options.devContext.proxy?.urls) {
    const _getURLs = devServer.listener.getURLs.bind(devServer.listener)
    devServer.listener.getURLs = async () =>
      Array.from(
        new Set([...options.devContext.proxy!.urls!, ...(await _getURLs())]),
      )
  }

  return devServer
}

// https://regex101.com/r/7HkR5c/1
const RESTART_RE
  = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/

class NuxtDevServer extends EventEmitter {
  private _handler?: RequestListener
  private _distWatcher?: FSWatcher
  private _currentNuxt?: Nuxt
  private _loadingMessage?: string
  private _jiti: Jiti

  loadDebounced: (reload?: boolean, reason?: string) => void
  handler: RequestListener
  listener: Listener

  constructor(private options: NuxtDevServerOptions) {
    super()

    this.loadDebounced = debounce(this.load)

    let _initResolve: () => void
    const _initPromise = new Promise<void>((resolve) => {
      _initResolve = resolve
    })
    this.once('ready', () => {
      _initResolve()
    })

    this._jiti = createJiti(options.cwd)

    this.handler = async (req, res) => {
      await _initPromise
      if (this._handler) {
        this._handler(req, res)
      }
      else {
        this._renderError(res)
      }
    }

    // @ts-expect-error we set it in wrapper function
    this.listener = undefined
  }

  async _renderError(res: ServerResponse, _error?: Error) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html')
    const loadingTemplate
      = this.options.loadingTemplate
        || this._currentNuxt?.options.devServer.loadingTemplate
        || await this._jiti.import<{ loading: () => string }>('@nuxt/ui-templates').then(r => r.loading).catch(() => {})
        || ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
    res.end(
      loadingTemplate({
        loading: _error?.toString() || this._loadingMessage || 'Loading...',
      }),
    )
  }

  async init() {
    await this.load()
    await this._watchConfig()
  }

  async load(reload?: boolean, reason?: string) {
    try {
      await this._load(reload, reason)
    }
    catch (error) {
      logger.error(`Cannot ${reload ? 'restart' : 'start'} nuxt: `, error)
      this._handler = undefined
      this._loadingMessage
        = 'Error while loading Nuxt. Please check console and fix errors.'
      this.emit('loading', this._loadingMessage)
    }
  }

  async _load(reload?: boolean, reason?: string) {
    const action = reload ? 'Restarting' : 'Starting'
    this._loadingMessage = `${reason ? `${reason}. ` : ''}${action} Nuxt...`
    this._handler = undefined
    this.emit('loading', this._loadingMessage)
    if (reload) {
      logger.info(this._loadingMessage)
    }

    if (this._currentNuxt) {
      await this._currentNuxt.close()
    }
    if (this._distWatcher) {
      await this._distWatcher.close()
    }

    const kit = await loadKit(this.options.cwd)

    this.options.overrides = defu(this.options.overrides, _getDevServerOverrides({}, await this.listener.getURLs().then(r => r.map(r => r.url))))
    this._currentNuxt = await kit.loadNuxt({
      cwd: this.options.cwd,
      dev: true,
      ready: false,
      envName: this.options.envName,
      overrides: {
        logLevel: this.options.logLevel as 'silent' | 'info' | 'verbose',
        nitro: {
          devErrorHandler: (error, event) => {
            this._renderError(event.node.res, error)
          },
        },
        ...this.options.overrides,
        vite: {
          clearScreen: this.options.clear,
          ...this.options.overrides.vite,
        },
      },
    })

    // Connect Vite HMR
    if (!process.env.NUXI_DISABLE_VITE_HMR) {
      this._currentNuxt.hooks.hook('vite:extend', ({ config }) => {
        if (config.server) {
          config.server.hmr = {
            protocol: undefined,
            ...(config.server.hmr as Exclude<typeof config.server.hmr, boolean>),
            port: undefined,
            host: undefined,
            server: this.listener.server,
          }
        }
      })
    }

    // Remove websocket handlers on close
    this._currentNuxt.hooks.hookOnce('close', () => {
      this.listener.server.removeAllListeners('upgrade')
    })

    // Write manifest and also check if we need cache invalidation
    if (!reload) {
      const previousManifest = await loadNuxtManifest(this._currentNuxt.options.buildDir)
      const newManifest = resolveNuxtManifest(this._currentNuxt)

      // we deliberately do not block initialising Nuxt on creation of the manifest
      const promise = writeNuxtManifest(this._currentNuxt, newManifest)
      this._currentNuxt.hooks.hookOnce('ready', async () => {
        await promise
      })

      if (
        previousManifest
        && newManifest
        && previousManifest._hash !== newManifest._hash
      ) {
        await clearBuildDir(this._currentNuxt.options.buildDir)
      }
    }

    await this._currentNuxt.ready()

    const unsub = this._currentNuxt.hooks.hook('restart', async (options) => {
      unsub() // We use this instead of `hookOnce` for Nuxt Bridge support
      if (options?.hard) {
        this.emit('restart')
        return
      }
      await this.load(true)
    })

    if (this._currentNuxt.server && 'upgrade' in this._currentNuxt.server) {
      this.listener.server.on(
        'upgrade',
        async (req: any, socket: any, head: any) => {
          const nuxt = this._currentNuxt
          if (!nuxt)
            return
          const viteHmrPath = joinURL(
            nuxt.options.app.baseURL.startsWith('./') ? nuxt.options.app.baseURL.slice(1) : nuxt.options.app.baseURL,
            nuxt.options.app.buildAssetsDir,
          )
          if (req.url.startsWith(viteHmrPath)) {
            return // Skip for Vite HMR
          }
          await nuxt.server.upgrade(req, socket, head)
        },
      )
    }

    await this._currentNuxt.hooks.callHook(
      'listen',
      this.listener.server,
      this.listener,
    )

    // Sync internal server info to the internals
    // It is important for vite-node to use the internal URL but public proto
    const addr = this.listener.address
    this._currentNuxt.options.devServer.host = addr.address
    this._currentNuxt.options.devServer.port = addr.port
    this._currentNuxt.options.devServer.url = _getAddressURL(
      addr,
      !!this.listener.https,
    )
    this._currentNuxt.options.devServer.https = this.options.devContext.proxy
      ?.https as boolean | { key: string, cert: string }

    if (this.listener.https && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      logger.warn(
        'You might need `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable to make https work.',
      )
    }

    await Promise.all([
      kit.writeTypes(this._currentNuxt).catch(console.error),
      kit.buildNuxt(this._currentNuxt),
    ])

    // Watch dist directory
    this._distWatcher = chokidar.watch(
      resolve(this._currentNuxt.options.buildDir, 'dist'),
      { ignoreInitial: true, depth: 0 },
    )
    this._distWatcher.on('unlinkDir', () => {
      this.loadDebounced(true, '.nuxt/dist directory has been removed')
    })

    this._handler = toNodeListener(this._currentNuxt.server.app)
    this.emit('ready', addr)
  }

  async _watchConfig() {
    const configWatcher = chokidar.watch(
      [this.options.cwd, join(this.options.cwd, '.config')],
      {
        ignoreInitial: true,
        depth: 0,
      },
    )
    configWatcher.on('all', (event, _file) => {
      if (event === 'all' || event === 'ready' || event === 'error' || event === 'raw') {
        return
      }
      const file = relative(this.options.cwd, _file)
      if (file === (this.options.dotenv || '.env')) {
        this.emit('restart')
      }
      if (RESTART_RE.test(file)) {
        this.loadDebounced(true, `${file} updated`)
      }
    })
  }
}

function _getAddressURL(addr: AddressInfo, https: boolean) {
  const proto = https ? 'https' : 'http'
  let host = addr.address.includes(':') ? `[${addr.address}]` : addr.address
  if (host === '[::]') {
    host = 'localhost' // Fix issues with Docker networking
  }
  const port = addr.port || 3000
  return `${proto}://${host}:${port}/`
}

export function _getDevServerOverrides(listenOptions: Partial<Pick<ListenOptions, 'hostname' | 'public' | 'https'>>, urls: string[] = []) {
  const defaultOverrides: Partial<NuxtConfig> = {}

  if (urls) {
    defaultOverrides.vite = { server: { allowedHosts: urls.map(u => new URL(u).hostname) } }
  }

  // defined hostname
  if (listenOptions.hostname) {
    const protocol = listenOptions.https ? 'https' : 'http'
    defaultOverrides.devServer = { cors: { origin: [`${protocol}://${listenOptions.hostname}`, ...urls] } }
    defaultOverrides.vite = defu(defaultOverrides.vite, { server: { allowedHosts: [listenOptions.hostname] } })
  }

  if (listenOptions.public) {
    defaultOverrides.devServer = { cors: { origin: '*' } }
    defaultOverrides.vite = { server: { allowedHosts: true } }
  }

  return defaultOverrides
}
