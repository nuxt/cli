import type { Nuxt, NuxtConfig } from '@nuxt/schema'
import type { DotenvOptions } from 'c12'
import type { HTTPSOptions, Listener, ListenOptions, ListenURL } from 'listhen'
import type { NitroDevServer } from 'nitropack'
import type { FSWatcher } from 'node:fs'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import EventEmitter from 'node:events'
import { watch } from 'node:fs'
import process from 'node:process'

import defu from 'defu'
import { toNodeListener } from 'h3'
import { listen } from 'listhen'
import { resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { provider } from 'std-env'
import { joinURL } from 'ufo'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'

import { renderError } from './error'

export type NuxtParentIPCMessage
  = | { type: 'nuxt:internal:dev:context', context: NuxtDevContext }

export type NuxtDevIPCMessage
  = | { type: 'nuxt:internal:dev:fork-ready' }
    | { type: 'nuxt:internal:dev:ready', address: string }
    | { type: 'nuxt:internal:dev:loading', message: string }
    | { type: 'nuxt:internal:dev:restart' }
    | { type: 'nuxt:internal:dev:rejection', message: string }
    | { type: 'nuxt:internal:dev:loading:error', error: Error }

export interface NuxtDevContext {
  cwd: string
  public?: boolean
  hostname?: string
  publicURLs?: string[]
  args: {
    clear: boolean
    logLevel: string
    dotenv: string
    envName: string
  }
  proxy?: {
    url?: string
    urls?: ListenURL[]
    https?: boolean | HTTPSOptions
  }
}

interface NuxtDevServerOptions {
  cwd: string
  logLevel?: 'silent' | 'info' | 'verbose'
  dotenv: DotenvOptions
  envName?: string
  clear?: boolean
  defaults: NuxtConfig
  overrides: NuxtConfig
  port?: string | number
  loadingTemplate?: ({ loading }: { loading: string }) => string
  devContext: NuxtDevContext
}

export async function createNuxtDevServer(options: NuxtDevServerOptions, listenOptions?: Partial<ListenOptions>) {
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
  devServer.listener._url = devServer.listener.url
  if (options.devContext.proxy?.url) {
    devServer.listener.url = options.devContext.proxy.url
  }
  if (options.devContext.proxy?.urls) {
    const _getURLs = devServer.listener.getURLs.bind(devServer.listener)
    devServer.listener.getURLs = async () => Array.from(new Set([...options.devContext.proxy?.urls || [], ...(await _getURLs())]))
  }

  return devServer
}

// https://regex101.com/r/7HkR5c/1
const RESTART_RE = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/

type NuxtWithServer = Omit<Nuxt, 'server'> & { server?: NitroDevServer }

interface DevServerEventMap {
  'loading:error': [error: Error]
  'loading': [loadingMessage: string]
  'ready': [address: string]
  'restart': []
}

export class NuxtDevServer extends EventEmitter<DevServerEventMap> {
  private _handler?: RequestListener
  private _distWatcher?: FSWatcher
  private _configWatcher?: FSWatcher
  private _currentNuxt?: NuxtWithServer
  private _loadingMessage?: string
  private _loadingError?: Error
  private cwd: string

  loadDebounced: (reload?: boolean, reason?: string) => void
  handler: RequestListener
  listener: Pick<Listener, 'server' | 'getURLs' | 'https' | 'url' | 'close'> & {
    _url?: string
    address: AddressInfo & { socketPath?: string }
  }

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

    this.cwd = options.cwd

    this.handler = async (req, res) => {
      if (this._loadingError) {
        this._renderError(req, res)
        return
      }
      await _initPromise
      if (this._handler) {
        this._handler(req, res)
      }
      else {
        this._renderLoadingScreen(req, res)
      }
    }

    // @ts-expect-error we set it in wrapper function
    this.listener = undefined
  }

  _renderError(req: IncomingMessage, res: ServerResponse) {
    renderError(req, res, this._loadingError)
  }

  async resolveLoadingTemplate() {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(this.cwd)
    const loading = await jiti.import<{ loading: () => string }>('@nuxt/ui-templates').then(r => r.loading).catch(() => {})

    return loading || ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
  }

  async _renderLoadingScreen(req: IncomingMessage, res: ServerResponse) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html')
    const loadingTemplate = this.options.loadingTemplate
      || this._currentNuxt?.options.devServer.loadingTemplate
      || await this.resolveLoadingTemplate()
    res.end(
      loadingTemplate({
        loading: this._loadingMessage || 'Loading...',
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
      this._loadingError = undefined
    }
    catch (error) {
      console.error(`Cannot ${reload ? 'restart' : 'start'} nuxt: `, error)
      this._handler = undefined
      this._loadingError = error as Error
      this._loadingMessage = 'Error while loading Nuxt. Please check console and fix errors.'
      this.emit('loading:error', error as Error)
    }
  }

  async close() {
    this._distWatcher?.close()
    this._configWatcher?.close()
    if (this._currentNuxt) {
      await this._currentNuxt.close()
    }
  }

  async _load(reload?: boolean, reason?: string) {
    const action = reload ? 'Restarting' : 'Starting'
    this._loadingMessage = `${reason ? `${reason}. ` : ''}${action} Nuxt...`
    this._handler = undefined
    this.emit('loading', this._loadingMessage)
    if (reload) {
      // eslint-disable-next-line no-console
      console.info(this._loadingMessage)
    }

    await this.close()

    const kit = await loadKit(this.options.cwd)

    const devServerDefaults = resolveDevServerDefaults({}, await this.listener.getURLs().then(r => r.map(r => r.url)))

    this._currentNuxt = await kit.loadNuxt({
      cwd: this.options.cwd,
      dev: true,
      ready: false,
      envName: this.options.envName,
      dotenv: {
        cwd: this.options.cwd,
        fileName: this.options.dotenv.fileName,
      },
      defaults: defu(this.options.defaults, devServerDefaults),
      overrides: {
        logLevel: this.options.logLevel as 'silent' | 'info' | 'verbose',
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
      this.listener.server.on('upgrade', (req, socket, head) => {
        const nuxt = this._currentNuxt
        if (!nuxt || !nuxt.server)
          return
        const viteHmrPath = joinURL(
          nuxt.options.app.baseURL.startsWith('./') ? nuxt.options.app.baseURL.slice(1) : nuxt.options.app.baseURL,
          nuxt.options.app.buildAssetsDir,
        )
        if (req.url?.startsWith(viteHmrPath)) {
          return // Skip for Vite HMR
        }
        nuxt.server.upgrade(req, socket, head)
      })
    }

    await this._currentNuxt.hooks.callHook('listen', this.listener.server, this.listener)

    // Sync internal server info to the internals
    // It is important for vite-node to use the internal URL but public proto
    const addr = this.listener.address
    this._currentNuxt.options.devServer.host = addr.address
    this._currentNuxt.options.devServer.port = addr.port
    this._currentNuxt.options.devServer.url = getAddressURL(addr, !!this.listener.https)
    this._currentNuxt.options.devServer.https = this.options.devContext.proxy
      ?.https as boolean | { key: string, cert: string }

    if (this.listener.https && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      console.warn('You might need `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable to make https work.')
    }

    await Promise.all([
      kit.writeTypes(this._currentNuxt).catch(console.error),
      kit.buildNuxt(this._currentNuxt),
    ])

    if (!this._currentNuxt.server) {
      throw new Error('Nitro server has not been initialized.')
    }

    // Watch dist directory
    this._distWatcher = watch(resolve(this._currentNuxt.options.buildDir, 'dist'))
    this._distWatcher.on('change', () => {
      this.loadDebounced(true, '.nuxt/dist directory has been removed')
    })

    this._handler = toNodeListener(this._currentNuxt.server.app)
    this.emit('ready', `http://127.0.0.1:${addr.port}`)
  }

  async _watchConfig() {
    this._configWatcher = watch(this.options.cwd, { recursive: true })

    this._configWatcher.on('change', (_event, file: string) => {
      if (file === (this.options.dotenv.fileName || '.env')) {
        this.emit('restart')
      }

      if (RESTART_RE.test(file)) {
        this.loadDebounced(true, `${file} updated`)
      }
    })
  }
}

function getAddressURL(addr: AddressInfo, https: boolean) {
  const proto = https ? 'https' : 'http'
  let host = addr.address.includes(':') ? `[${addr.address}]` : addr.address
  if (host === '[::]') {
    host = 'localhost' // Fix issues with Docker networking
  }
  const port = addr.port || 3000
  return `${proto}://${host}:${port}/`
}

export function resolveDevServerOverrides(listenOptions: Partial<Pick<ListenOptions, 'public'>>) {
  if (listenOptions.public || provider === 'codesandbox') {
    return {
      devServer: { cors: { origin: '*' } },
      vite: { server: { allowedHosts: true } },
    } as const
  }

  return {}
}

export function resolveDevServerDefaults(listenOptions: Partial<Pick<ListenOptions, 'hostname' | 'https'>>, urls: string[] = []) {
  const defaultConfig: Partial<NuxtConfig> = {}

  if (urls) {
    defaultConfig.vite = { server: { allowedHosts: urls.map(u => new URL(u).hostname) } }
  }

  // defined hostname
  if (listenOptions.hostname) {
    const protocol = listenOptions.https ? 'https' : 'http'
    defaultConfig.devServer = { cors: { origin: [`${protocol}://${listenOptions.hostname}`, ...urls] } }
    defaultConfig.vite = defu(defaultConfig.vite, { server: { allowedHosts: [listenOptions.hostname] } })
  }

  return defaultConfig
}
