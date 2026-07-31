import type { Nuxt, NuxtConfig, NuxtOptions, ViteConfig } from '@nuxt/schema'
import type { createDevServer } from 'nitro/builder'
import type { NitroDevServer } from 'nitropack'
import type { FSWatcher } from 'node:fs'
import type { Server as HttpServer, IncomingMessage, RequestListener, ServerResponse } from 'node:http'

import type { ResolvedCertificate } from './cert'
import type { InspectOptions } from './inspect'
import type { DevListenOverrides, Listener, ListenOptions } from './listen'
import type { DevRestartReason } from './reason'
import EventEmitter from 'node:events'
import { existsSync, readdirSync, statSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'

import { pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import defu from 'defu'
import { resolveModulePath } from 'exsolve'
import { toNodeListener } from 'h3'
import { join, resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { toNodeHandler } from 'srvx/node'
import { provider } from 'std-env'

import { joinURL } from 'ufo'
import { showBanner } from '../utils/banner'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, formatLockError, updateLock } from '../utils/lockfile'
import { debug } from '../utils/logger'
import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { withNodePath } from '../utils/paths'
import { renderError, renderErrorAnsi } from './error-lazy'
import { listen } from './listen'
import { resolvePortlessURLs } from './portless'
import { formatChangedKeys, formatRestartReason, formatSkippedReload, mergeRestartReasons, withConfigKeys } from './reason'

export type NuxtParentIPCMessage
  = | { type: 'nuxt:internal:dev:context', context: NuxtDevContext, listenOverrides: DevListenOverrides, inspect?: InspectOptions }

export type NuxtDevIPCMessage
  = | { type: 'nuxt:internal:dev:fork-ready' }
    | { type: 'nuxt:internal:dev:ready', address: string }
    | { type: 'nuxt:internal:dev:loading', message: string }
    | { type: 'nuxt:internal:dev:restart', reason?: DevRestartReason }
    | { type: 'nuxt:internal:dev:rejection', message: string }
    | { type: 'nuxt:internal:dev:loading:error', error: Error }

export interface NuxtDevContext {
  cwd: string
  /** PID of the dev server this process is taking over from, if any. */
  handoverFrom?: number
  args: {
    clear?: boolean
    logLevel?: string
    dotenv?: string
    envName?: string
    extends?: string
    profile?: string | boolean
  }
}

interface DotenvOptions {
  cwd?: string
  fileName?: string | string[]
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
  listenOverrides?: DevListenOverrides
  handoverFrom?: number
}

// https://regex101.com/r/7HkR5c/1
const RESTART_RE = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/
const TRAILING_SLASH_RE = /\/$/

export class FileChangeTracker {
  private mtimes = new Map<string, number>()

  shouldEmitChange(filePath: string): boolean {
    const resolved = resolve(filePath)
    try {
      const stats = statSync(resolved)
      const currentMtime = stats.mtimeMs
      const lastMtime = this.mtimes.get(resolved)

      this.mtimes.set(resolved, currentMtime)

      // emit change for new file or mtime has changed
      return lastMtime === undefined || currentMtime !== lastMtime
    }
    catch {
      // remove from cache if it has been deleted or is inaccessible
      this.mtimes.delete(resolved)
      return true
    }
  }

  prime(filePath: string, recursive: boolean = false): void {
    const resolved = resolve(filePath)
    const stat = statSync(resolved)
    this.mtimes.set(resolved, stat.mtimeMs)
    if (stat.isDirectory()) {
      const entries = readdirSync(resolved)
      for (const entry of entries) {
        const fullPath = resolve(resolved, entry)
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

type ViteServerOptions = NonNullable<ViteConfig['server']>
type HmrOptions = Exclude<ViteServerOptions['hmr'], boolean>

/**
 * Pin Vite's HMR websocket to the main dev server so no separate HMR port is allocated.
 * vite >= 8.1 reads `server.ws`; older versions only read `server.hmr`.
 */
export function attachViteHmrServer(server: ViteServerOptions, hmrServer: HttpServer): void {
  const target = server as Omit<ViteServerOptions, 'ws'> & { ws?: HmrOptions | boolean }
  target.ws = {
    protocol: undefined,
    ...(target.ws as HmrOptions),
    port: undefined,
    host: undefined,
    server: hmrServer,
  }
  target.hmr = {
    protocol: undefined,
    ...(target.hmr as HmrOptions),
    port: undefined,
    host: undefined,
    server: hmrServer,
  }
}

interface NuxtConfigDiffEntry {
  key: string
}

/**
 * `onConfigResolved` and `diffNuxtConfig` were added in a later `@nuxt/kit` than the one
 * whose types are pinned here, and the kit is resolved from the user's project, so both are
 * treated as optional capabilities. Older kits pass the unknown option through to `c12`,
 * which ignores it.
 */
type LoadNuxtOptionsWithConfigDiff = Parameters<typeof import('@nuxt/kit').loadNuxt>[0] & {
  onConfigResolved?: (ctx: { rawConfig: Record<string, unknown> }) => void | Promise<void>
}

function resolveConfigDiffer(kit: Awaited<ReturnType<typeof loadKit>>) {
  const differ = (kit as { diffNuxtConfig?: (oldConfig: unknown, newConfig: unknown) => NuxtConfigDiffEntry[] }).diffNuxtConfig
  return typeof differ === 'function' ? differ : undefined
}

interface DevServerEventMap {
  'loading:error': [error: Error]
  'loading': [loadingMessage: string]
  'ready': [address: string]
  'restart': [reason?: DevRestartReason]
  'change': []
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
  #inflightResponses = new Set<ServerResponse>()
  #lockCleanup?: () => void
  #lockedBuildDir?: string
  #pendingReason?: DevRestartReason
  #rawConfig?: Record<string, unknown>
  #changedConfigKeys?: string[]

  loadDebounced: () => void
  handler: RequestListener
  listener!: Listener

  constructor(private options: NuxtDevServerOptions) {
    super()

    this.loadDebounced = debounce(async () => {
      const reason = this.#pendingReason
      this.#pendingReason = undefined

      if (reason?.type === 'config' && !this.#loadingError && await this.#isConfigUnchanged()) {
        // eslint-disable-next-line no-console
        console.info(formatSkippedReload(reason, { rootDir: this.#cwd }))
        return
      }

      return this.load(true, reason)
    })

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
        void renderError(req, res, this.#loadingError)
        return
      }
      await _initPromise
      if (this.#handler) {
        this.#inflightResponses.add(res)
        res.once('close', () => {
          this.#inflightResponses.delete(res)
        })
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
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Refresh', '3')

    if (!req.headers.accept?.includes('text/html')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        error: true,
        status: 503,
        message: this.#loadingMessage || 'Dev server is loading...',
        hint: 'Please retry once the dev server is ready.',
      }, null, 2))
      return
    }

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

    // Acquire lock before binding a listener so parallel agent invocations
    // fail fast without starting a second server (agent-only).
    this.#acquireDevLock(this.#currentNuxt!.options.buildDir)

    if (this.options.showBanner) {
      showBanner(this.#currentNuxt!)
    }

    await this.#createListener()
    await this.#initializeNuxt(false)
    this.#watchConfig()
  }

  closeWatchers(): void {
    this.#distWatcher?.close()
    this.#configWatcher?.()
  }

  /**
   * Queue a debounced in-place reload, accumulating the reasons for every
   * change that arrives within the debounce window.
   */
  scheduleReload(reason: DevRestartReason): void {
    this.#pendingReason = mergeRestartReasons(this.#pendingReason, reason)
    this.loadDebounced()
  }

  async load(reload?: boolean, reason?: DevRestartReason): Promise<void> {
    try {
      this.closeWatchers()

      // For reloads, we already have a listener, so use the existing flow
      await this.#load(reload, reason)

      this.#loadingError = undefined
    }
    catch (error) {
      console.error(
        `Cannot ${reload ? 'restart' : 'start'} nuxt: `,
        await renderErrorAnsi(error).catch(() => error),
      )
      this.#handler = undefined
      this.#loadingError = error as Error
      this.#loadingMessage = 'Error while loading Nuxt. Please check console and fix errors.'
      this.emit('loading:error', error as Error)
    }
    this.#watchConfig()
  }

  #createLoadOptions(urls?: string[]): LoadNuxtOptionsWithConfigDiff {
    const loadOptions: LoadNuxtOptionsWithConfigDiff = {
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
      const hostname = this.options.listenOverrides?.hostname
      loadOptions.defaults = resolveDevServerDefaults({ hostname, https: !!this.listener?.https }, urls)
    }

    return loadOptions
  }

  /**
   * Resolve the config without instantiating Nuxt, to find out which keys a watched
   * config file actually changed. Returns `undefined` when no comparison is possible
   * (no baseline, an older `@nuxt/kit`, or a config that failed to load), in which case
   * the caller should reload and let the normal path surface any error.
   */
  async #resolveConfigChange(urls?: string[]): Promise<string[] | undefined> {
    const previous = this.#rawConfig
    if (!previous) {
      return undefined
    }

    const kit = await loadKit(this.options.cwd)
    const diffNuxtConfig = resolveConfigDiffer(kit)
    if (!diffNuxtConfig || typeof kit.loadNuxtConfig !== 'function') {
      return undefined
    }

    let keys: string[] | undefined
    const loadOptions = this.#createLoadOptions(urls)
    loadOptions.onConfigResolved = ({ rawConfig }) => {
      try {
        keys = diffNuxtConfig(previous, rawConfig).map(entry => entry.key)
      }
      catch (error) {
        // `ohash`'s diff walks the config without a cycle guard
        debug('Could not diff nuxt config:', error)
      }
    }

    try {
      await kit.loadNuxtConfig(loadOptions)
    }
    catch (error) {
      debug('Could not resolve nuxt config:', error)
      return undefined
    }

    return keys
  }

  /**
   * Report a reload as a single console entry, so the changed keys stay attached to the
   * line they explain rather than being prefixed as a separate log message.
   */
  #reportReload(reason: DevRestartReason | undefined): void {
    const lines = [formatRestartReason(reason, { rootDir: this.#cwd })]

    const changedKeys = reason?.type === 'config' && formatChangedKeys(reason.keys ?? [])
    if (changedKeys) {
      lines.push(styleText('dim', `  ${changedKeys}`))
    }

    // eslint-disable-next-line no-console
    console.info(lines.join('\n'))
  }

  async #isConfigUnchanged(): Promise<boolean> {
    const urls = this.listener?.getURLs().map(({ url }) => url)
    return await this.#resolveConfigChange(urls).then(keys => keys?.length === 0)
  }

  async #loadNuxtInstance(urls?: string[]): Promise<void> {
    const kit = await loadKit(this.options.cwd)
    const loadOptions = this.#createLoadOptions(urls)

    const diffNuxtConfig = resolveConfigDiffer(kit)
    if (diffNuxtConfig) {
      this.#changedConfigKeys = undefined
      loadOptions.onConfigResolved = ({ rawConfig }) => {
        const previous = this.#rawConfig
        this.#rawConfig = rawConfig
        if (previous) {
          try {
            this.#changedConfigKeys = diffNuxtConfig(previous, rawConfig).map(entry => entry.key)
          }
          catch (error) {
            // `ohash`'s diff walks the config without a cycle guard
            debug('Could not diff nuxt config:', error)
          }
        }
      }
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
    const urls = this.listener.getURLs().map(({ url }) => url)
    if (urls.length > 0) {
      this.#currentNuxt.options.vite = defu(this.#currentNuxt.options.vite, {
        server: {
          allowedHosts: urls.map(u => new URL(u).hostname),
        },
      })
    }
  }

  #resolveListenOptions(): ListenOptions {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before resolving listen options')
    }

    const nuxtConfig = this.#currentNuxt.options
    const { httpsEnabled, ...overrides } = this.options.listenOverrides || {}

    const port = overrides.port ?? nuxtConfig.devServer?.port

    const hostname = overrides.hostname ?? nuxtConfig.devServer?.host

    // Resolve public flag
    const isPublic = provider === 'codesandbox' || (overrides.public ?? (isPublicHostname(hostname) ? true : undefined))

    // `--https` (or its absence) wins over the config; `https.*` arguments and
    // `devServer.https` options only apply once https is enabled.
    const httpsFromConfig = typeof nuxtConfig.devServer?.https === 'object' ? nuxtConfig.devServer.https : {}
    const https = (httpsEnabled ?? !!nuxtConfig.devServer?.https)
      && defu(typeof overrides.https === 'object' ? overrides.https : {}, httpsFromConfig)

    // Resolve baseURL
    const baseURL = nuxtConfig.app?.baseURL?.startsWith?.('./')
      ? nuxtConfig.app.baseURL.slice(1)
      : nuxtConfig.app?.baseURL

    return {
      ...overrides,
      port,
      hostname,
      public: isPublic,
      https: https || undefined,
      baseURL,
    }
  }

  async #initializeNuxt(reload: boolean): Promise<void> {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before configuration')
    }

    this.#currentNuxt.hooks.hook('builder:watch', () => {
      this.emit('change')
    })

    // Connect Vite HMR
    if (!process.env.NUXI_DISABLE_VITE_HMR) {
      this.#currentNuxt.hooks.hook('vite:extend', ({ config }) => {
        if (config.server) {
          attachViteHmrServer(config.server, this.listener.server)
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

    this.#currentNuxt.hooks.hookOnce('restart', async (options) => {
      if (options?.hard) {
        this.emit('restart', { type: 'hook' })
        return
      }
      await this.load(true, { type: 'hook' })
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
        nuxt.server.upgrade(req, socket as any, head)

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
    this.#currentNuxt.options.devServer.https = resolveDevServerHTTPS(this.listener.https)

    if (this.listener.https && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      console.warn('You might need `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable to make https work.')
    }

    const kit = await loadKit(this.options.cwd)
    // ensure tsconfigs exist before starting the dev server (vite relies on in the initialisation stage)
    const typesPromise = existsSync(join(this.#currentNuxt.options.buildDir, 'tsconfig.json'))
      ? kit.writeTypes(this.#currentNuxt).catch(console.error)
      : await kit.writeTypes(this.#currentNuxt).catch(console.error)

    await Promise.all([typesPromise, kit.buildNuxt(this.#currentNuxt)])

    if (!this.#currentNuxt.server) {
      throw new Error('Nitro server has not been initialized.')
    }

    // Watch dist directory
    const distDir = join(this.#currentNuxt.options.buildDir, 'dist')
    await mkdir(distDir, { recursive: true })
    this.#fileChangeTracker.prime(distDir)
    this.#distWatcher = watch(distDir)
    this.#distWatcher.on('change', (_event, file: string) => {
      // do not restart if the directory has not been removed
      if (existsSync(distDir)) {
        return
      }
      if (!this.#fileChangeTracker.shouldEmitChange(resolve(distDir, file || ''))) {
        return
      }

      this.scheduleReload({ type: 'dist-removed' })
    })

    if ('handler' in this.#currentNuxt.server) {
      this.#handler = this.#currentNuxt.server.handler as RequestListener
    }
    else if ('fetch' in this.#currentNuxt.server) {
      this.#handler = toNodeHandler(this.#currentNuxt.server.fetch) as RequestListener
    }
    else {
      this.#handler = toNodeListener(this.#currentNuxt.server.app)
    }

    // Emit ready with the server URL
    const serverUrl = getAddressURL(addr, !!this.listener.https).replace(TRAILING_SLASH_RE, '')

    // Re-acquire if buildDir changed (nuxt.config edits can move it on reload);
    // otherwise just overwrite port/url in place.
    const currentBuildDir = this.#currentNuxt.options.buildDir
    if (this.#lockedBuildDir !== currentBuildDir) {
      this.#acquireDevLock(currentBuildDir)
    }
    updateLock(currentBuildDir, {
      command: 'dev',
      cwd: this.options.cwd,
      port: addr.port,
      hostname: addr.address,
      url: serverUrl,
    })

    this.emit('ready', serverUrl)
  }

  async close(): Promise<void> {
    if (this.#currentNuxt) {
      await this.#currentNuxt.close()
    }
  }

  /** Release the lock file. Call only on final shutdown, not during reloads. */
  releaseLock(): void {
    this.#lockCleanup?.()
    this.#lockCleanup = undefined
    this.#lockedBuildDir = undefined
  }

  #acquireDevLock(buildDir: string): void {
    const lock = acquireLock(buildDir, {
      command: 'dev',
      cwd: this.options.cwd,
    }, {
      // During a handover the outgoing dev server still holds the lock until
      // this process is ready to serve.
      takeoverFrom: this.options.handoverFrom,
    })
    if (lock.existing) {
      console.error(formatLockError(lock.existing))
      throw new Error(`Another Nuxt ${lock.existing.command} is already running (PID ${lock.existing.pid}).`)
    }
    // Swap atomically: install the new release before freeing the old one so
    // we're never unlocked in between.
    const previousRelease = this.#lockCleanup
    this.#lockCleanup = lock.release
    this.#lockedBuildDir = buildDir
    previousRelease?.()
  }

  /**
   * Requests handed to the outgoing Nitro handler are never answered once it is
   * torn down, so respond (or drop the socket) before swapping the handler out.
   */
  #settleInflightResponses(): void {
    const responses = [...this.#inflightResponses]
    this.#inflightResponses.clear()
    for (const res of responses) {
      if (res.writableEnded || res.destroyed) {
        continue
      }
      if (res.headersSent) {
        res.destroy()
        continue
      }
      void this.#renderLoadingScreen(res.req, res).catch(() => res.destroy())
    }
  }

  #closeWebSocketConnections(): void {
    for (const socket of this.#websocketConnections) {
      socket.destroy()
    }
    this.#websocketConnections.clear()
  }

  async #load(reload?: boolean, reason?: DevRestartReason): Promise<void> {
    this.#loadingMessage = reload
      ? formatRestartReason(reason, { rootDir: this.#cwd, link: false })
      : 'Starting Nuxt...'
    this.#handler = undefined
    this.#settleInflightResponses()
    this.emit('loading', this.#loadingMessage)

    await this.close()

    const urls = this.listener.getURLs().map(({ url }) => url)

    try {
      // The changed config keys are only known once the config has been resolved,
      // so the reason is reported after loading rather than before.
      await this.#loadNuxtInstance(urls)
    }
    finally {
      if (reload) {
        this.#reportReload(withConfigKeys(reason, this.#changedConfigKeys))
      }
    }

    // Configure the Nuxt instance (shared logic with initial load)
    await this.#initializeNuxt(!!reload)
  }

  #watchConfig(): void {
    this.#configWatcher = createConfigWatcher(
      this.#cwd,
      this.options.dotenv.fileName,
      file => this.emit('restart', { type: 'config', files: [file] }),
      (file) => {
        this.emit('change')
        this.scheduleReload({ type: 'config', files: [file] })
      },
      getLocalLayerDirs(this.#currentNuxt?.options._layers ?? [], this.#cwd),
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

function resolveDevServerHTTPS(certificate: false | ResolvedCertificate): NuxtOptions['devServer']['https'] {
  if (!certificate) {
    return false
  }
  if (certificate.pfxPath) {
    return { pfx: certificate.pfxPath, passphrase: certificate.passphrase ?? '' }
  }
  return { key: certificate.key!, cert: certificate.cert! }
}

function resolveDevServerDefaults(listenOptions: { hostname?: string, https: boolean }, urls: string[] = []): Partial<NuxtConfig> {
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

  // Browser requests reach us through the portless proxy, so its origins have
  // to be allowed even when the server itself is bound to localhost.
  const portlessOrigins = resolvePortlessURLs().all
  if (portlessOrigins.length > 0) {
    defaultConfig.devServer = defu(defaultConfig.devServer, { cors: { origin: portlessOrigins } })
  }

  return defaultConfig
}

// Skips the root (already watched) and external layers (`node_modules` or out of tree) whose config
// isn't expected to change during local dev.
export function getLocalLayerDirs(layers: ReadonlyArray<{ cwd?: string, config?: { rootDir?: string } | null }>, cwd: string): string[] {
  const root = resolve(cwd)
  const dirs = new Set<string>()
  for (const layer of layers) {
    const dir = layer.cwd || layer.config?.rootDir
    const resolved = dir && resolve(dir)
    if (resolved && resolved !== root && resolved.startsWith(`${root}/`) && !resolved.includes('/node_modules/')) {
      dirs.add(resolved)
    }
  }
  return [...dirs]
}

function createConfigWatcher(cwd: string, dotenvFileName: string | string[] = '.env', onRestart: (file: string) => void, onReload: (file: string) => void, layerDirs: string[] = []) {
  const dotenvFileNames = new Set(Array.isArray(dotenvFileName) ? dotenvFileName : [dotenvFileName])

  // each local layer dir is watched alongside the root, but only the root restarts on dotenv changes.
  const closers = [
    watchConfigDir(cwd, onReload, (file, path) => dotenvFileNames.has(file) && onRestart(path)),
    ...layerDirs.map(dir => watchConfigDir(dir, onReload)),
  ]

  return () => {
    for (const close of closers) {
      close()
    }
  }
}

function watchConfigDir(dir: string, onReload: (path: string) => void, onFile?: (file: string, path: string) => void) {
  const fileWatcher = new FileChangeTracker()
  fileWatcher.prime(dir)
  const watcher = watch(dir)
  let configDirWatcher = existsSync(join(dir, '.config')) ? createConfigDirWatcher(dir, onReload) : undefined

  watcher.on('change', (_event, file: string | null) => {
    if (!file || !fileWatcher.shouldEmitChange(resolve(dir, file))) {
      return
    }

    onFile?.(file, resolve(dir, file))

    if (RESTART_RE.test(file)) {
      onReload(resolve(dir, file))
    }

    if (file === '.config') {
      configDirWatcher ||= createConfigDirWatcher(dir, onReload)
    }
  })

  return () => {
    watcher.close()
    configDirWatcher?.()
  }
}

function createConfigDirWatcher(cwd: string, onReload: (path: string) => void) {
  const configDir = join(cwd, '.config')
  const fileWatcher = new FileChangeTracker()

  fileWatcher.prime(configDir)
  const configDirWatcher = watch(configDir)
  configDirWatcher.on('change', (_event, file: string) => {
    if (!fileWatcher.shouldEmitChange(resolve(configDir, file))) {
      return
    }

    if (RESTART_RE.test(file)) {
      onReload(resolve(configDir, file))
    }
  })

  return () => configDirWatcher.close()
}

// Fallback for requests that arrive before the Nuxt instance has loaded
async function resolveLoadingTemplate(cwd: string): Promise<({ loading }: { loading?: string }) => string> {
  const nuxtPath = resolveModulePath('nuxt', { from: withNodePath(cwd), try: true })
  const uiTemplatesPath = resolveModulePath('@nuxt/ui-templates', { from: withNodePath(nuxtPath || cwd) })
  const r: { loading: (opts?: { loading?: string }) => string } = await import(pathToFileURL(uiTemplatesPath).href)

  return r.loading || ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
}

function isPublicHostname(hostname: string | undefined): boolean {
  return !!hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname)
}
