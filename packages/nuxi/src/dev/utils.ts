import type { Nuxt, NuxtConfig } from '@nuxt/schema'
import type { DotenvOptions } from 'c12'
import type { Listener, ListenOptions } from 'listhen'
import type { createDevServer } from 'nitro/builder'
import type { NitroDevServer } from 'nitropack'
import type { FSWatcher } from 'node:fs'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'

import EventEmitter from 'node:events'
import { existsSync, readdirSync, statSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import defu from 'defu'
import { resolveModulePath } from 'exsolve'
import { toNodeListener } from 'h3'
import { listen } from 'listhen'
import { resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { toNodeHandler } from 'srvx/node'
import { provider } from 'std-env'
import { joinURL } from 'ufo'

import { showVersionsFromConfig } from '../utils/banner'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { withNodePath } from '../utils/paths'
import { renderError } from './error'

export type NuxtParentIPCMessage
  = | { type: 'nuxt:internal:dev:context', context: NuxtDevContext, listenOverrides: Partial<ListenOptions> }

export type NuxtDevIPCMessage
  = | { type: 'nuxt:internal:dev:fork-ready' }
    | { type: 'nuxt:internal:dev:ready', address: string }
    | { type: 'nuxt:internal:dev:loading', message: string }
    | { type: 'nuxt:internal:dev:restart' }
    | { type: 'nuxt:internal:dev:rejection', message: string }
    | { type: 'nuxt:internal:dev:loading:error', error: Error }

export interface NuxtDevContext {
  cwd: string
  args: {
    clear: boolean
    logLevel: string
    dotenv: string
    envName: string
    extends?: string
  }
}

interface NuxtDevServerOptions {
  cwd: string
  logLevel?: 'silent' | 'info' | 'verbose'
  dotenv: DotenvOptions
  envName?: string
  clear?: boolean
  overrides: NuxtConfig
  loadingTemplate?: ({ loading }: { loading: string }) => string
  showBanner?: boolean
  listenOverrides?: Partial<ListenOptions>
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

  prime(directory: string, recursive: boolean = false): void {
    const stat = statSync(directory)
    this.mtimes.set(directory, stat.mtimeMs)
    if (stat.isDirectory()) {
      const entries = readdirSync(directory)
      for (const entry of entries) {
        const fullPath = resolve(directory, entry)
        try {
          const stats = statSync(fullPath)
          this.mtimes.set(fullPath, stats.mtimeMs)
          if (recursive && stats.isDirectory()) {
            this.prime(fullPath, recursive)
          }
        }
        catch {
          // ignore
        }
      }
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
  #handler?: RequestListener
  #distWatcher?: FSWatcher
  #configWatcher?: () => void
  #currentNuxt?: NuxtWithServer
  #loadingMessage?: string
  #loadingError?: Error
  #fileChangeTracker = new FileChangeTracker()
  #cwd: string
  #websocketConnections = new Set<any>()

  loadDebounced: (reload?: boolean, reason?: string) => void
  handler: RequestListener
  listener!: Listener

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

    this.#cwd = options.cwd

    this.handler = async (req, res) => {
      if (this.#loadingError) {
        renderError(req, res, this.#loadingError)
        return
      }
      await _initPromise
      if (this.#handler) {
        this.#handler(req, res)
      }
      else {
        this.#renderLoadingScreen(req, res)
      }
    }
  }

  async #renderLoadingScreen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end()
      }
      return
    }

    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html')
    const loadingTemplate = this.options.loadingTemplate
      || this.#currentNuxt?.options.devServer.loadingTemplate
      || await resolveLoadingTemplate(this.#cwd)
    res.end(
      loadingTemplate({
        loading: this.#loadingMessage || 'Loading...',
      }),
    )
  }

  async init(): Promise<void> {
    const action = 'Starting'
    this.#loadingMessage = `${action} Nuxt...`
    this.#handler = undefined
    this.emit('loading', this.#loadingMessage)

    await this.#loadNuxtInstance()

    if (this.options.showBanner) {
      showVersionsFromConfig(this.options.cwd, this.#currentNuxt!.options)
    }

    await this.#createListener()
    await this.#initializeNuxt(false)
    this.#watchConfig()
  }

  closeWatchers(): void {
    this.#distWatcher?.close()
    this.#configWatcher?.()
  }

  async load(reload?: boolean, reason?: string): Promise<void> {
    try {
      this.closeWatchers()

      // For reloads, we already have a listener, so use the existing flow
      await this.#load(reload, reason)

      this.#loadingError = undefined
    }
    catch (error) {
      console.error(`Cannot ${reload ? 'restart' : 'start'} nuxt: `, error)
      this.#handler = undefined
      this.#loadingError = error as Error
      this.#loadingMessage = 'Error while loading Nuxt. Please check console and fix errors.'
      this.emit('loading:error', error as Error)
    }
    this.#watchConfig()
  }

  async #loadNuxtInstance(urls?: string[]): Promise<void> {
    const kit = await loadKit(this.options.cwd)

    const loadOptions: Parameters<typeof kit.loadNuxt>[0] = {
      cwd: this.options.cwd,
      dev: true,
      ready: false,
      envName: this.options.envName,
      dotenv: {
        cwd: this.options.cwd,
        fileName: this.options.dotenv.fileName,
      },
      overrides: {
        logLevel: this.options.logLevel as 'silent' | 'info' | 'verbose',
        ...this.options.overrides,
        vite: {
          clearScreen: this.options.clear,
          ...this.options.overrides.vite,
        },
      },
    }

    if (urls) {
      // Pass hostname and https info for proper CORS and allowedHosts setup
      const overrides = this.options.listenOverrides || {}
      const hostname = overrides.hostname
      const https = overrides.https

      loadOptions.defaults = resolveDevServerDefaults({ hostname, https }, urls)
    }

    this.#currentNuxt = await kit.loadNuxt(loadOptions)
  }

  async #createListener(): Promise<void> {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before creating listener')
    }

    // Merge config values with CLI overrides
    const listenOptions = this.#resolveListenOptions()
    this.listener = await listen(this.handler, listenOptions)

    // Apply devServer overrides based on whether listener is public
    if (listenOptions.public) {
      this.#currentNuxt.options.devServer.cors = { origin: '*' }
      if (this.#currentNuxt.options.vite?.server) {
        this.#currentNuxt.options.vite.server.allowedHosts = true
      }
      return
    }

    // Get listener URLs for configuring allowed hosts
    const urls = await this.listener.getURLs().then(r => r.map(r => r.url))
    if (urls && urls.length > 0) {
      this.#currentNuxt.options.vite = defu(this.#currentNuxt.options.vite, {
        server: {
          allowedHosts: urls.map(u => new URL(u).hostname),
        },
      })
    }
  }

  #resolveListenOptions(): Partial<ListenOptions> {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before resolving listen options')
    }

    const nuxtConfig = this.#currentNuxt.options
    const overrides = this.options.listenOverrides || {}

    const port = overrides.port ?? nuxtConfig.devServer?.port

    const hostname = overrides.hostname ?? nuxtConfig.devServer?.host

    // Resolve public flag
    const isPublic = provider === 'codesandbox' || (overrides.public ?? (isPublicHostname(hostname) ? true : undefined))

    // Resolve HTTPS options
    const httpsFromConfig = typeof nuxtConfig.devServer?.https !== 'boolean' && nuxtConfig.devServer?.https
      ? nuxtConfig.devServer.https
      : {}

    ;(overrides as any)._https ??= !!nuxtConfig.devServer?.https

    const httpsOptions = overrides.https && defu(
      (typeof overrides.https === 'object' ? overrides.https : {}),
      httpsFromConfig,
    )

    // Resolve baseURL
    const baseURL = nuxtConfig.app?.baseURL?.startsWith?.('./')
      ? nuxtConfig.app.baseURL.slice(1)
      : nuxtConfig.app?.baseURL

    return {
      ...overrides,
      port,
      hostname,
      public: isPublic,
      https: httpsOptions || undefined,
      baseURL,
    }
  }

  async #initializeNuxt(reload: boolean): Promise<void> {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before configuration')
    }

    // Connect Vite HMR
    if (!process.env.NUXI_DISABLE_VITE_HMR) {
      this.#currentNuxt.hooks.hook('vite:extend', ({ config }) => {
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
    this.#currentNuxt.hooks.hookOnce('close', () => {
      this.#closeWebSocketConnections()
      this.listener.server.removeAllListeners('upgrade')
    })

    // Write manifest and also check if we need cache invalidation
    if (!reload) {
      const previousManifest = await loadNuxtManifest(this.#currentNuxt.options.buildDir)
      const newManifest = resolveNuxtManifest(this.#currentNuxt)

      // we deliberately do not block initialising Nuxt on creation of the manifest
      const promise = writeNuxtManifest(this.#currentNuxt, newManifest)
      this.#currentNuxt.hooks.hookOnce('ready', async () => {
        await promise
      })

      if (
        previousManifest
        && newManifest
        && previousManifest._hash !== newManifest._hash
      ) {
        await clearBuildDir(this.#currentNuxt.options.buildDir)
      }
    }

    await this.#currentNuxt.ready()

    const unsub = this.#currentNuxt.hooks.hook('restart', async (options) => {
      unsub() // We use this instead of `hookOnce` for Nuxt Bridge support
      if (options?.hard) {
        this.emit('restart')
        return
      }
      await this.load(true)
    })

    if (this.#currentNuxt.server && 'upgrade' in this.#currentNuxt.server) {
      this.listener.server.on('upgrade', (req, socket, head) => {
        const nuxt = this.#currentNuxt
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

        // Track WebSocket connections
        this.#websocketConnections.add(socket)
        socket.on('close', () => {
          this.#websocketConnections.delete(socket)
        })
      })
    }

    await this.#currentNuxt.hooks.callHook('listen', this.listener.server, this.listener)

    // Sync internal server info to the internals BEFORE building
    // This prevents Nitro from trying to create its own listener
    const addr = this.listener.address
    this.#currentNuxt.options.devServer.host = addr.address
    this.#currentNuxt.options.devServer.port = addr.port
    this.#currentNuxt.options.devServer.url = getAddressURL(addr, !!this.listener.https)
    this.#currentNuxt.options.devServer.https = this.listener.https as boolean | { key: string, cert: string }

    if (this.listener.https && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      console.warn('You might need `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable to make https work.')
    }

    const kit = await loadKit(this.options.cwd)
    await Promise.all([
      kit.writeTypes(this.#currentNuxt).catch(console.error),
      kit.buildNuxt(this.#currentNuxt),
    ])

    if (!this.#currentNuxt.server) {
      throw new Error('Nitro server has not been initialized.')
    }

    // Watch dist directory
    const distDir = resolve(this.#currentNuxt.options.buildDir, 'dist')
    await mkdir(distDir, { recursive: true })
    this.#fileChangeTracker.prime(distDir)
    this.#distWatcher = watch(distDir)
    this.#distWatcher.on('change', (_event, file: string) => {
      if (!this.#fileChangeTracker.shouldEmitChange(resolve(distDir, file || ''))) {
        return
      }

      this.loadDebounced(true, '.nuxt/dist directory has been removed')
    })

    if ('fetch' in this.#currentNuxt.server) {
      this.#handler = toNodeHandler(this.#currentNuxt.server.fetch)
    }
    else {
      this.#handler = toNodeListener(this.#currentNuxt.server.app)
    }

    // Emit ready with the server URL
    const proto = this.listener.https ? 'https' : 'http'
    this.emit('ready', `${proto}://127.0.0.1:${addr.port}`)
  }

  async close(): Promise<void> {
    if (this.#currentNuxt) {
      await this.#currentNuxt.close()
    }
  }

  #closeWebSocketConnections(): void {
    for (const socket of this.#websocketConnections) {
      socket.destroy()
    }
    this.#websocketConnections.clear()
  }

  async #load(reload?: boolean, reason?: string): Promise<void> {
    const action = reload ? 'Restarting' : 'Starting'
    this.#loadingMessage = `${reason ? `${reason}. ` : ''}${action} Nuxt...`
    this.#handler = undefined
    this.emit('loading', this.#loadingMessage)
    if (reload) {
      // eslint-disable-next-line no-console
      console.info(this.#loadingMessage)
    }

    await this.close()

    const urls = await this.listener.getURLs().then(r => r.map(r => r.url))

    await this.#loadNuxtInstance(urls)

    // Configure the Nuxt instance (shared logic with initial load)
    await this.#initializeNuxt(!!reload)
  }

  #watchConfig(): void {
    this.#configWatcher = createConfigWatcher(
      this.#cwd,
      this.options.dotenv.fileName,
      () => this.emit('restart'),
      file => this.loadDebounced(true, `${file} updated`),
    )
  }
}

function getAddressURL(addr: { address: string, port: number }, https: boolean) {
  const proto = https ? 'https' : 'http'
  let host = addr.address.includes(':') ? `[${addr.address}]` : addr.address
  if (host === '[::]') {
    host = 'localhost' // Fix issues with Docker networking
  }
  const port = addr.port || 3000
  return `${proto}://${host}:${port}/`
}

function resolveDevServerDefaults(listenOptions: Partial<Pick<ListenOptions, 'hostname' | 'https'>>, urls: string[] = []): Partial<NuxtConfig> {
  const defaultConfig: Partial<NuxtConfig> = {}

  if (urls && urls.length > 0) {
    defaultConfig.vite = {
      server: {
        allowedHosts: urls.map(u => new URL(u).hostname),
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
  const fileWatcher = new FileChangeTracker()
  fileWatcher.prime(cwd)
  const configWatcher = watch(cwd)
  let configDirWatcher = existsSync(resolve(cwd, '.config')) ? createConfigDirWatcher(cwd, onReload) : undefined
  const dotenvFileNames = new Set(Array.isArray(dotenvFileName) ? dotenvFileName : [dotenvFileName])

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

  fileWatcher.prime(configDir)
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
async function resolveLoadingTemplate(cwd: string): Promise<({ loading }: { loading?: string }) => string> {
  const nuxtPath = resolveModulePath('nuxt', { from: withNodePath(cwd), try: true })
  const uiTemplatesPath = resolveModulePath('@nuxt/ui-templates', { from: withNodePath(nuxtPath || cwd) })
  const r: { loading: (opts?: { loading?: string }) => string } = await import(pathToFileURL(uiTemplatesPath).href)

  return r.loading || ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
}

function isPublicHostname(hostname: string | undefined): boolean {
  return !!hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname)
}
