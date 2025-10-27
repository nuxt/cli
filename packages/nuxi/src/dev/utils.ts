import type { Nuxt, NuxtConfig } from '@nuxt/schema'
import type { DotenvOptions } from 'c12'
import type { HTTPSOptions, Listener, ListenOptions, ListenURL } from 'listhen'
import type { createDevServer } from 'nitro'
import type { NitroDevServer } from 'nitropack'
import type { FSWatcher } from 'node:fs'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import EventEmitter from 'node:events'
import { existsSync, statSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import defu from 'defu'
import { resolveModulePath } from 'exsolve'
import { toNodeListener } from 'h3'
import { resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { toNodeHandler } from 'srvx/node'
import { provider } from 'std-env'
import { joinURL } from 'ufo'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'

import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { renderError } from './error'
import { formatSocketURL, isSocketURL } from './socket'

export type NuxtParentIPCMessage
  = | { type: 'nuxt:internal:dev:context', context: NuxtDevContext, socket?: boolean }

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
    extends?: string
  }
  proxy?: {
    url?: string
    urls?: ListenURL[]
    https?: boolean | HTTPSOptions
    addr?: AddressInfo
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
  loadingTemplate?: ({ loading }: { loading: string }) => string
  devContext: Pick<NuxtDevContext, 'proxy'>
}

// https://regex101.com/r/7HkR5c/1
const RESTART_RE = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/

export class FileChangeTracker {
  private mtimes = new Map<string, number>()

  shouldEmitChange(filePath: string): boolean {
    try {
      const stats = statSync(filePath)
      const currentMtime = stats.mtimeMs
      const lastMtime = this.mtimes.get(filePath)

      this.mtimes.set(filePath, currentMtime)

      // emit change for new file or mtime has changed
      return lastMtime === undefined || currentMtime !== lastMtime
    }
    catch {
      // remove from cache if it has been deleted or is inaccessible
      this.mtimes.delete(filePath)
      return true
    }
  }
}

type NuxtWithServer = Omit<Nuxt, 'server'> & { server?: NitroDevServer | ReturnType<typeof createDevServer> }

interface DevServerEventMap {
  'loading:error': [error: Error]
  'loading': [loadingMessage: string]
  'ready': [address: string]
  'restart': []
}

export class NuxtDevServer extends EventEmitter<DevServerEventMap> {
  private _handler?: RequestListener
  private _distWatcher?: FSWatcher
  private _configWatcher?: () => void
  private _currentNuxt?: NuxtWithServer
  private _loadingMessage?: string
  private _loadingError?: Error
  private _fileChangeTracker = new FileChangeTracker()
  private cwd: string

  loadDebounced: (reload?: boolean, reason?: string) => void
  handler: RequestListener
  listener: Pick<Listener, 'server' | 'getURLs' | 'https' | 'url' | 'close'> & {
    _url?: string
    address: Omit<AddressInfo, 'family'> & { socketPath: string } | AddressInfo
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

  _renderError(req: IncomingMessage, res: ServerResponse): void {
    renderError(req, res, this._loadingError)
  }

  async _renderLoadingScreen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end()
      }
      return
    }

    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html')
    const loadingTemplate = this.options.loadingTemplate
      || this._currentNuxt?.options.devServer.loadingTemplate
      || await resolveLoadingTemplate(this.cwd)
    res.end(
      loadingTemplate({
        loading: this._loadingMessage || 'Loading...',
      }),
    )
  }

  async init(): Promise<void> {
    await this.load()
    this._watchConfig()
  }

  closeWatchers(): void {
    this._distWatcher?.close()
    this._configWatcher?.()
  }

  async load(reload?: boolean, reason?: string): Promise<void> {
    try {
      this.closeWatchers()
      await this._load(reload, reason)
      this._watchConfig()
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

  async close(): Promise<void> {
    if (this._currentNuxt) {
      await this._currentNuxt.close()
    }
  }

  async _load(reload?: boolean, reason?: string): Promise<void> {
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
    this._currentNuxt.options.devServer.https = this.options.devContext.proxy?.https as boolean | { key: string, cert: string }

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
    const distDir = resolve(this._currentNuxt.options.buildDir, 'dist')
    await mkdir(distDir, { recursive: true })
    this._distWatcher = watch(distDir)
    this._distWatcher.on('change', (_event, file: string) => {
      if (!this._fileChangeTracker.shouldEmitChange(resolve(distDir, file || ''))) {
        return
      }

      this.loadDebounced(true, '.nuxt/dist directory has been removed')
    })

    if ('fetch' in this._currentNuxt.server) {
      this._handler = toNodeHandler(this._currentNuxt.server.fetch)
    }
    else {
      this._handler = toNodeListener(this._currentNuxt.server.app)
    }
    this.emit('ready', 'socketPath' in addr ? formatSocketURL(addr.socketPath, !!this.listener.https) : `http://127.0.0.1:${addr.port}`)
  }

  _watchConfig(): void {
    this._configWatcher = createConfigWatcher(
      this.cwd,
      this.options.dotenv.fileName,
      () => this.emit('restart'),
      file => this.loadDebounced(true, `${file} updated`),
    )
  }
}

function getAddressURL(addr: Pick<AddressInfo, 'address' | 'port'>, https: boolean) {
  const proto = https ? 'https' : 'http'
  let host = addr.address.includes(':') ? `[${addr.address}]` : addr.address
  if (host === '[::]') {
    host = 'localhost' // Fix issues with Docker networking
  }
  const port = addr.port || 3000
  return `${proto}://${host}:${port}/`
}

export function resolveDevServerOverrides(listenOptions: Partial<Pick<ListenOptions, 'public'>>): Partial<Pick<NuxtConfig, 'devServer' | 'vite'>> {
  if (listenOptions.public || provider === 'codesandbox') {
    return {
      devServer: { cors: { origin: '*' } },
      vite: { server: { allowedHosts: true } },
    } as const
  }

  return {}
}

export function resolveDevServerDefaults(listenOptions: Partial<Pick<ListenOptions, 'hostname' | 'https'>>, urls: string[] = []): Partial<NuxtConfig> {
  const defaultConfig: Partial<NuxtConfig> = {}

  if (urls) {
    defaultConfig.vite = {
      server: {
        allowedHosts: urls.filter(u => !isSocketURL(u)).map(u => new URL(u).hostname),
      },
    }
  }

  // defined hostname
  if (listenOptions.hostname) {
    const protocol = listenOptions.https ? 'https' : 'http'
    defaultConfig.devServer = { cors: { origin: [`${protocol}://${listenOptions.hostname}`, ...urls] } }
    defaultConfig.vite = defu(defaultConfig.vite, { server: { allowedHosts: [listenOptions.hostname] } })
  }

  return defaultConfig
}

function createConfigWatcher(cwd: string, dotenvFileName: string | string[] = '.env', onRestart: () => void, onReload: (file: string) => void) {
  const configWatcher = watch(cwd)
  let configDirWatcher = existsSync(resolve(cwd, '.config')) ? createConfigDirWatcher(cwd, onReload) : undefined
  const dotenvFileNames = new Set(Array.isArray(dotenvFileName) ? dotenvFileName : [dotenvFileName])
  const fileWatcher = new FileChangeTracker()

  configWatcher.on('change', (_event, file: string) => {
    if (!fileWatcher.shouldEmitChange(resolve(cwd, file))) {
      return
    }

    if (dotenvFileNames.has(file)) {
      onRestart()
    }

    if (RESTART_RE.test(file)) {
      onReload(file)
    }

    if (file === '.config') {
      configDirWatcher ||= createConfigDirWatcher(cwd, onReload)
    }
  })

  return () => {
    configWatcher.close()
    configDirWatcher?.()
  }
}

function createConfigDirWatcher(cwd: string, onReload: (file: string) => void) {
  const configDir = resolve(cwd, '.config')
  const fileWatcher = new FileChangeTracker()

  const configDirWatcher = watch(configDir)
  configDirWatcher.on('change', (_event, file: string) => {
    if (!fileWatcher.shouldEmitChange(resolve(configDir, file))) {
      return
    }

    if (RESTART_RE.test(file)) {
      onReload(file)
    }
  })

  return () => configDirWatcher.close()
}

// Nuxt <3.6 did not have the loading template defined in the schema
export async function resolveLoadingTemplate(cwd: string): Promise<({ loading }: { loading?: string }) => string> {
  const nuxtPath = resolveModulePath('nuxt', { from: cwd, try: true })
  const uiTemplatesPath = resolveModulePath('@nuxt/ui-templates', { from: nuxtPath || cwd })
  const r: { loading: (opts?: { loading?: string }) => string } = await import(pathToFileURL(uiTemplatesPath).href)

  return r.loading || ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
}
