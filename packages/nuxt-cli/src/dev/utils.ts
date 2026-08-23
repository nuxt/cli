import type { Nuxt, NuxtConfig, NuxtOptions, ViteConfig } from '@nuxt/schema'
import type { createDevServer } from 'nitro/builder'
import type { NitroDevServer } from 'nitropack'
import type { FSWatcher, Stats } from 'node:fs'
import type { Server as HttpServer, IncomingMessage, RequestListener, ServerResponse } from 'node:http'

import type { ResolvedCertificate } from './cert'
import type { InspectOptions } from './inspect'
import type { BoundServer, DevListenOverrides, Listener, ListenOptions, ListenURL } from './listen'
import type { DevRestartReason } from './reason'
import { Buffer } from 'node:buffer'
import { hash } from 'node:crypto'
import EventEmitter from 'node:events'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { styleText } from 'node:util'
import defu from 'defu'
import { resolveModulePath } from 'exsolve'
import { toNodeListener } from 'h3'
import { join, resolve } from 'pathe'
import { debounce } from 'perfect-debounce'
import { toNodeHandler } from 'srvx/node'
import { provider } from 'std-env'

import { showBanner } from '../utils/banner'
import { loadDevServerHint, saveDevServerHint } from '../utils/dev-hint'
import { ActionableError } from '../utils/errors'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, formatLockError, getTakeoverPid, updateLock } from '../utils/lockfile'
import { debug, logger, writeNotice } from '../utils/logger'
import { loadNuxtManifest, resolveNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { renderError, renderErrorAnsi } from './error-lazy'
import { bindListener, createListener, matchesBoundTarget, openBrowser, resolveOpenURL } from './listen'
import { RECOVERY_SCRIPT, withProgress } from './loading-page'
import { resolveDefaultLoadingTemplate } from './loading-template'
import { resolvePortlessURLs } from './portless'
import { DevProgress } from './progress'
import { formatChangedKeys, formatRestartReason, formatSkippedReload, mergeRestartReasons, withConfigKeys } from './reason'
import { encodeRequest, REQUEST_HEADER, runWithRequest } from './serving-state'

/**
 * Nitro plugin that attributes the app's logs to the request that caused them,
 * from inside the module runner's realm. Resolved through this package's own
 * exports because the caller may be bundled into any chunk.
 */
function registerRequestContextPlugin(nitro: NitroConfigForHook, cwd: string): void {
  try {
    const source = fileURLToPath(import.meta.resolve('@nuxt/cli/runtime/dev-request-context'))
    const id = join(nitro.buildDir || join(cwd, '.nuxt'), 'dev-request-context.mjs')
    // The build dir is not a package, so `consola` is pinned to the copy the app
    // itself logs through; a bare specifier would not resolve from there.
    const consola = resolveConsola(cwd)
    nitro.virtual ||= {}
    nitro.virtual[id] = () => readFileSync(source, 'utf8').replace('\'consola\'', JSON.stringify(consola))
    nitro.plugins ||= []
    nitro.plugins.push(id)
  }
  catch (error) {
    debug('Could not resolve the request context plugin; app logs will not be attributed:', error)
  }
}

/**
 * The `consola` the app itself logs through, which is the one
 * `@nuxt/nitro-server` wraps `console` with: its own, not the CLI's. Reporting
 * from any other instance sees none of the app's logs.
 */
function resolveConsola(cwd: string): string {
  const nuxt = resolveModulePath('nuxt', { from: cwd, try: true })
  const from = [nuxt, cwd].filter(Boolean) as string[]
  return resolveModulePath('consola', { from, try: true }) ?? fileURLToPath(import.meta.resolve('consola'))
}

type NitroConfigForHook = Parameters<NonNullable<NonNullable<NuxtConfig['hooks']>['nitro:config']>>[0]

export type NuxtParentIPCMessage
  = | { type: 'nuxt:internal:dev:context', context: NuxtDevContext, listenOverrides: DevListenOverrides, inspect?: InspectOptions }
    | { type: 'nuxt:internal:dev:shutdown' }
    | { type: 'nuxt:internal:dev:resize', columns: number }

export type NuxtDevIPCMessage
  = | { type: 'nuxt:internal:dev:fork-ready' }
    | { type: 'nuxt:internal:dev:ready', address: string }
    | { type: 'nuxt:internal:dev:loading', message: string }
    | { type: 'nuxt:internal:dev:restart', reason?: DevRestartReason }
    | { type: 'nuxt:internal:dev:rejection', message: string }
    | { type: 'nuxt:internal:dev:loading:error', error: Error }
    | { type: 'nuxt:internal:dev:log', level: number, logType: string, tag?: string, message: string, origin: 'build' | 'runtime', request?: string, requestId?: number }
    | { type: 'nuxt:internal:dev:requests', requests: DevRequestEvent[] }
    | { type: 'nuxt:internal:dev:routes', payload: DevRoutes }
    | { type: 'nuxt:internal:dev:building', building: boolean }

export interface NuxtDevContext {
  cwd: string
  /** PID of the dev server this process is taking over from, if any. */
  handoverFrom?: number
  args: {
    clear?: boolean
    logLevel?: string
    dotenv?: string[]
    envName?: string
    extends?: string[]
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
  loadingTemplate?: (data: { loading?: string }) => string
  showBanner?: boolean
  listenOverrides?: DevListenOverrides
  handoverFrom?: number
  /** Emit `request` and `routes` events for the interactive dev UI. */
  captureUIEvents?: boolean
}

/**
 * PID of the process supervising this one, when this is a dev fork. Recorded in
 * the lock so a takeover stops the supervisor too, rather than leaving it
 * running with nothing to serve.
 */
function devForkParentPid(): number | undefined {
  if (!process.env.__NUXT__FORK || !process.send) {
    return undefined
  }
  // A supervisor that already exited leaves us reparented to init, which must
  // never be signalled.
  return process.ppid > 1 ? process.ppid : undefined
}

// https://regex101.com/r/7HkR5c/1
const RESTART_RE = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/
const TRAILING_SLASH_RE = /\/$/

/**
 * Files above this size are tracked by mtime alone.
 */
const MAX_HASHED_FILE_SIZE = 256 * 1024

interface TrackedFile {
  mtimeMs: number
  /** Absent for directories and for files too large to hash. */
  contentHash?: string
}

function hashFileContents(path: string, size: number): string | undefined {
  if (size > MAX_HASHED_FILE_SIZE) {
    return undefined
  }
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    // The stat'd size can be stale, so cap the read rather than trusting it; an
    // extra byte means the file outgrew the limit and falls back to mtime.
    const buffer = Buffer.allocUnsafe(MAX_HASHED_FILE_SIZE + 1)
    let read = 0
    while (read < buffer.length) {
      const bytes = readSync(fd, buffer, read, buffer.length - read, read)
      if (bytes === 0) {
        break
      }
      read += bytes
    }
    if (read > MAX_HASHED_FILE_SIZE) {
      return undefined
    }
    return hash('sha1', buffer.subarray(0, read), 'hex')
  }
  catch {
    return undefined
  }
  finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      }
      catch {}
    }
  }
}

function trackFile(path: string, stats: Stats): TrackedFile {
  if (stats.isDirectory()) {
    return { mtimeMs: stats.mtimeMs }
  }
  return { mtimeMs: stats.mtimeMs, contentHash: hashFileContents(path, stats.size) }
}

export class FileChangeTracker {
  private entries = new Map<string, TrackedFile>()

  /**
   * Whether a watcher event for `filePath` represents a real change.
   *
   * Regular files are compared by content, so identical rewrites (atomic saves,
   * formatters, `git checkout` of the same revision) do not trigger a reload.
   * Directories and files over `MAX_HASHED_FILE_SIZE` fall back to mtime.
   */
  shouldEmitChange(filePath: string): boolean {
    const resolved = resolve(filePath)
    try {
      const stats = statSync(resolved)
      const previous = this.entries.get(resolved)
      const current = trackFile(resolved, stats)

      this.entries.set(resolved, current)

      if (previous === undefined) {
        return true
      }
      if (previous.contentHash !== undefined && current.contentHash !== undefined) {
        return previous.contentHash !== current.contentHash
      }
      return previous.mtimeMs !== current.mtimeMs
    }
    catch {
      // remove from cache if it has been deleted or is inaccessible
      this.entries.delete(resolved)
      return true
    }
  }

  prime(filePath: string, recursive: boolean = false): void {
    const resolved = resolve(filePath)
    const stat = statSync(resolved)
    this.entries.set(resolved, trackFile(resolved, stat))
    if (stat.isDirectory()) {
      const entries = readdirSync(resolved)
      for (const entry of entries) {
        const fullPath = resolve(resolved, entry)
        try {
          const stats = statSync(fullPath)
          this.entries.set(fullPath, trackFile(fullPath, stats))
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

/** The app's routes, plus the component that renders its errors. */
export interface DevRoutes {
  routes: DevRoute[]
  /** Component rendering error responses, linked from failed requests. */
  errorComponent?: string
}

/** A page or server route the app defines, as listed in the dev UI. */
export interface DevRoute {
  kind: 'page' | 'server'
  route: string
  method?: string
  file?: string
}

/** A request served by the dev server, as shown in the dev UI. */
export interface DevRequestEvent {
  /** Identity shared with the logs attributed to this request. */
  id?: number
  method: string
  url: string
  status: number
  /** Milliseconds from receiving the request to the response closing. */
  duration: number
  /** Served by the bundler (module graph, HMR plumbing) rather than the app. */
  internal?: boolean
}

/** Vite/webpack module-graph URLs: `/@id/...`, `/@fs/...`, `virtual:` modules, SFC block queries. */
const BUNDLER_URL_RE = /^\/(?:@|__|_nuxt\/)|\/node_modules\/|virtual:|[?&](?:vue&type=|import(?:&|=|$)|direct(?:&|=|$)|html-proxy|raw(?:&|=|$)|worker(?:&|=|$))/

/**
 * Whether a request is the bundler talking to itself rather than the app being
 * used. There is no dedicated header, but in dev every script and style
 * subresource is served through the bundler pipeline, so `sec-fetch-dest`
 * identifies most of it and the URL shape catches the rest.
 */
export function isBundlerRequest(url: string, fetchDest?: string): boolean {
  return fetchDest === 'script' || fetchDest === 'style' || BUNDLER_URL_RE.test(url)
}

interface DevServerEventMap {
  'loading:error': [error: Error]
  'loading': [loadingMessage: string]
  /** The socket is bound; `confirmed` once the resolved config agrees. */
  'listening': [info: { url: string, urls: ListenURL[], confirmed: boolean }]
  'ready': [address: string]
  'restart': [reason?: DevRestartReason]
  'change': []
  'request': [event: DevRequestEvent]
  'routes': [payload: DevRoutes]
  'building': [building: boolean]
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
  /** Responses the CLI answered itself, kept out of the dev UI's request feed. */
  #internalResponses = new Set<ServerResponse>()
  #lockCleanup?: () => void
  #lockedBuildDir?: string
  #pendingReason?: DevRestartReason
  #rawConfig?: Record<string, unknown>
  #changedConfigKeys?: string[]
  #bound?: BoundServer
  #openedEagerly = false
  #progress = new DevProgress()

  loadDebounced: () => void
  handler: RequestListener
  /** Live startup progress, streamed to the loading page and the terminal. */
  progress: DevProgress = this.#progress
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

    this.#cwd = options.cwd

    this.handler = async (req, res) => {
      // Internal endpoints answer before Nuxt exists, so they are matched ahead
      // of anything that waits on the first successful load, and they stay out
      // of the request feed.
      if (this.#progress.handleRequest(req, res)) {
        return
      }
      if (!options.captureUIEvents) {
        return this.#serve(req, res)
      }
      const start = performance.now()
      return runWithRequest(`${req.method || 'GET'} ${req.url || '/'}`, (request) => {
        const encoded = encodeRequest(request)
        req.headers[REQUEST_HEADER] = encoded
        req.rawHeaders.push(REQUEST_HEADER, encoded)
        res.once('close', () => {
          if (this.#internalResponses.delete(res)) {
            return
          }
          this.emit('request', {
            id: request.id,
            method: req.method || 'GET',
            url: req.url || '/',
            status: res.statusCode,
            duration: Math.round(performance.now() - start),
            internal: isBundlerRequest(req.url || '/', String(req.headers['sec-fetch-dest'] || '') || undefined) || undefined,
          })
        })
        return this.#serve(req, res)
      })
    }
  }

  async #serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.#loadingError) {
      if (this.options.captureUIEvents) {
        this.#internalResponses.add(res)
      }
      // The recovery script makes the page reload itself once the next load
      // starts, so a fixed file shows up without the reader touching anything.
      await renderError(req, res, this.#loadingError, { inject: RECOVERY_SCRIPT })
      return
    }
    if (!this.#handler) {
      if (this.options.captureUIEvents) {
        this.#internalResponses.add(res)
      }
      await this.#renderLoadingScreen(req, res).catch((error) => {
        debug('Could not render the loading screen:', error)
        if (res.headersSent) {
          res.end()
          return
        }
        res.statusCode = 503
        res.end('Dev server is loading...')
      })
      return
    }
    this.#inflightResponses.add(res)
    res.once('close', () => {
      this.#inflightResponses.delete(res)
    })
    this.#handler(req, res)
  }

  async #renderLoadingScreen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end()
      }
      return
    }

    const snapshot = this.#progress.snapshot
    res.statusCode = 503
    res.setHeader('Cache-Control', 'no-store')

    const accept = req.headers.accept
    if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Retry-After', '1')
      res.end(JSON.stringify({
        error: true,
        status: 503,
        message: this.#loadingMessage || 'Dev server is loading...',
        phase: snapshot.phase,
        progress: Number(snapshot.progress.toFixed(2)),
        elapsed: snapshot.elapsed,
        hint: 'Please retry once the dev server is ready.',
      }, null, 2))
      return
    }

    res.setHeader('Content-Type', 'text/html')

    const message = this.#loadingMessage || 'Loading...'
    const withMessage = { ...snapshot, message }

    // Every Nuxt this CLI supports ships a loading page, so the bare message is
    // only reached when the project cannot be resolved at all.
    const template = this.options.loadingTemplate
      || this.#currentNuxt?.options.devServer.loadingTemplate
      || await resolveDefaultLoadingTemplate(this.#cwd)
    if (!template) {
      res.setHeader('Refresh', '3')
      res.end(message)
      return
    }

    // Nuxt's own page carries this marker in the script it polls itself with, so
    // finding it says the page will update on its own and can take progress. A
    // page the project supplied is served untouched and keeps the reload header,
    // which is the only thing that would move it along.
    const html = template({ loading: message })
    if (!html.includes('__NUXT_LOADING__')) {
      res.setHeader('Refresh', '3')
      res.end(html)
      return
    }

    res.end(withProgress(html, withMessage))
  }

  /**
   * Load Nuxt, bind the listener and serve the app.
   *
   * Rejects if the first load fails, because there is no server to hand back;
   * a later {@link load} instead catches, emits `loading:error` and serves the
   * error page, so a caller that only listens for the event will never hear
   * about a failed startup.
   */
  async init(): Promise<void> {
    const action = 'Starting'
    this.#loadingMessage = `${action} Nuxt...`
    this.#handler = undefined
    this.#progress.start(this.#loadingMessage)
    this.emit('loading', this.#loadingMessage)

    await this.#bindEagerListener()

    await this.#loadNuxtInstance(this.#bound && this.listener.getURLs().map(({ url }) => url))

    // Acquire lock before serving so parallel agent invocations
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
      this.#progress.setError(error as Error)
      this.emit('loading:error', error as Error)
    }
    this.#watchConfig()
  }

  #createLoadOptions(urls?: string[]): LoadNuxtOptionsWithConfigDiff {
    const captureUIEvents = this.options.captureUIEvents
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
        ...captureUIEvents
          ? {
              hooks: {
                ...this.options.overrides.hooks,
                'nitro:config': (nitro) => {
                  registerRequestContextPlugin(nitro, this.options.cwd)
                  return this.options.overrides.hooks?.['nitro:config']?.(nitro)
                },
              } satisfies NuxtConfig['hooks'],
            }
          : {},
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

    if (this.options.captureUIEvents) {
      this.#collectRoutes(this.#currentNuxt)
      this.#watchServerBuilds(this.#currentNuxt)
    }
  }

  /**
   * Report Nitro rebuilds, which happen on every server-side change and are
   * otherwise invisible: only full Nuxt reloads emit `loading`.
   *
   * In dev the rebuild is driven by rollup's watcher, which reports `dev:start`
   * rather than the `rollup:before` of a one-shot build.
   */
  #watchServerBuilds(nuxt: Nuxt): void {
    nuxt.hook('nitro:init', (nitro) => {
      for (const started of ['dev:start', 'rollup:before'] as const) {
        nitro.hooks.hook(started, () => {
          this.emit('building', true)
        })
      }
      for (const finished of ['compiled', 'dev:reload', 'dev:error'] as const) {
        nitro.hooks.hook(finished, () => {
          this.emit('building', false)
        })
      }
    })
  }

  /**
   * Gather the app's routes.
   *
   * Every hook here is an optional capability: a project without the pages
   * module, or without a nitro server, simply contributes nothing.
   */
  #collectRoutes(nuxt: Nuxt): void {
    const routes: DevRoute[] = []
    let errorComponent: string | undefined
    const emit = () => this.emit('routes', { routes: [...routes], errorComponent })

    // `errorComponent` is minified in Nuxt's published build, so the shipped
    // property name is checked as well as the source one.
    nuxt.hook('app:resolve', (app) => {
      const resolved = app as { errorComponent?: string | null, n?: string | null }
      errorComponent = resolved.errorComponent ?? resolved.n ?? undefined
      emit()
    })

    nuxt.hook('pages:extend', (pages: Array<{ path: string, file?: string, children?: unknown[] }>) => {
      const flatten = (list: typeof pages, prefix = '') => {
        for (const page of list) {
          const path = page.path.startsWith('/') ? page.path : `${prefix}/${page.path}`.replace(/\/+/g, '/')
          routes.push({ kind: 'page', route: path, file: page.file })
          flatten((page.children ?? []) as typeof pages, path)
        }
      }
      routes.splice(0, routes.length, ...routes.filter(route => route.kind !== 'page'))
      flatten(pages)
      emit()
    })

    nuxt.hook('nitro:build:before', (nitro: { scannedHandlers?: Array<{ route?: string, method?: string, handler?: string }> }) => {
      routes.splice(0, routes.length, ...routes.filter(route => route.kind !== 'server'))
      for (const handler of nitro.scannedHandlers ?? []) {
        if (handler.route) {
          routes.push({ kind: 'server', route: handler.route, method: handler.method, file: handler.handler })
        }
      }
      emit()
    })
  }

  /**
   * Bind a socket before the Nuxt config is known, so the port answers within
   * milliseconds of spawn and pre-ready requests get the loading screen instead
   * of hanging. The address is taken from the CLI/env, else from the address the
   * previous run resolved, else from the schema default.
   *
   * A guessed address is only a guess: `#createListener` rebinds if the resolved
   * config disagrees. Set `NUXT_DEV_EAGER_LISTEN=0` to bind after the config instead.
   */
  async #bindEagerListener(): Promise<void> {
    if (process.env.NUXT_DEV_EAGER_LISTEN === '0' || process.env.NUXT_DEV_EAGER_LISTEN === 'false') {
      return
    }

    const overrides = this.options.listenOverrides || {}
    const hint = loadDevServerHint(this.options.cwd)

    // Without `--https` only `nuxt.config` knows whether https is wanted, and the
    // certificate options that come with it are not in the hint.
    if (overrides.httpsEnabled === undefined && hint?.https) {
      return
    }
    const httpsEnabled = !!overrides.httpsEnabled

    const hasExplicitPort = overrides.port !== undefined && overrides.port !== ''
    const listenOptions: ListenOptions = {
      ...overrides,
      port: hasExplicitPort ? overrides.port : hint?.port,
      hostname: overrides.hostname ?? hint?.hostname,
      baseURL: hint?.baseURL,
      https: httpsEnabled ? overrides.https : undefined,
      showURL: false,
      open: false,
      clipboard: false,
      tunnel: false,
    }

    try {
      this.#bound = await bindListener(this.handler, listenOptions)
    }
    catch (error) {
      // An explicit port is the user's instruction, so its failure is a real
      // error; a guessed one may simply disagree with the config.
      if (hasExplicitPort) {
        throw error
      }
      debug('Could not bind the dev server before loading Nuxt:', error)
      return
    }

    this.listener = await createListener(this.#bound, listenOptions, { announce: false })
    this.emit('listening', { url: this.listener.url, urls: this.listener.getURLs(), confirmed: false })

    const knowsScheme = overrides.httpsEnabled !== undefined || hint?.https === false
    if (overrides.open && knowsScheme && (hasExplicitPort || hint?.port === this.#bound.address.port)) {
      this.#openedEagerly = true
      openBrowser(overrides.openURL ? resolveOpenURL(overrides.openURL, this.listener.url) : this.listener.url)
    }
  }

  async #createListener(): Promise<void> {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before creating listener')
    }

    const listenOptions = this.#resolveListenOptions()
    this.#persistDevServerHint(listenOptions.baseURL)

    if (this.#bound && !matchesBoundTarget(this.#bound, listenOptions)) {
      // Only loading screens have been served so far, so rebinding is safe.
      await this.listener.close()
      this.#bound = undefined
      this.#openedEagerly = false
    }

    this.#bound ??= await bindListener(this.handler, listenOptions)
    this.listener = await createListener(this.#bound, {
      ...listenOptions,
      open: listenOptions.open && !this.#openedEagerly,
    })
    this.emit('listening', { url: this.listener.url, urls: this.listener.getURLs(), confirmed: true })

    if (listenOptions.public) {
      this.#currentNuxt.options.devServer.cors = { origin: '*' }
      if (this.#currentNuxt.options.vite?.server) {
        this.#currentNuxt.options.vite.server.allowedHosts = true
      }
      return
    }

    const urls = this.listener.getURLs().map(({ url }) => url)
    if (urls.length > 0) {
      this.#currentNuxt.options.vite = defu(this.#currentNuxt.options.vite, {
        server: {
          allowedHosts: urls.map(u => new URL(u).hostname),
        },
      })
      const allowedHosts = this.#currentNuxt.options.vite.server?.allowedHosts
      if (Array.isArray(allowedHosts)) {
        this.#currentNuxt.options.vite.server!.allowedHosts = dedupe(allowedHosts)
      }
    }
  }

  /**
   * Record the address `nuxt.config` resolves to, so the next run can bind it
   * before loading the config. CLI and env overrides are deliberately excluded:
   * a one-off `--port` should not change where the next plain run binds.
   */
  #persistDevServerHint(baseURL?: string): void {
    const devServer = this.#currentNuxt?.options.devServer
    if (!devServer) {
      return
    }
    saveDevServerHint(this.options.cwd, {
      port: Number(devServer.port) || undefined,
      hostname: devServer.host || undefined,
      https: !!devServer.https,
      baseURL,
    })
  }

  #resolveListenOptions(): ListenOptions {
    if (!this.#currentNuxt) {
      throw new Error('Nuxt must be loaded before resolving listen options')
    }

    const nuxtConfig = this.#currentNuxt.options
    const { httpsEnabled, ...overrides } = this.options.listenOverrides || {}

    const port = overrides.port ?? nuxtConfig.devServer?.port

    const hostname = overrides.hostname ?? nuxtConfig.devServer?.host

    const isPublic = provider === 'codesandbox' || (overrides.public ?? (isPublicHostname(hostname) ? true : undefined))

    // `--https` (or its absence) wins over the config; `https.*` arguments and
    // `devServer.https` options only apply once https is enabled.
    const httpsFromConfig = typeof nuxtConfig.devServer?.https === 'object' ? nuxtConfig.devServer.https : {}
    const https = (httpsEnabled ?? !!nuxtConfig.devServer?.https)
      && defu(typeof overrides.https === 'object' ? overrides.https : {}, httpsFromConfig)

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

    this.#progress.attachNuxt(this.#currentNuxt.hooks)
    this.#progress.setPhase('modules')

    this.#currentNuxt.hooks.hook('builder:watch', () => {
      this.emit('change')
    })

    if (!process.env.NUXI_DISABLE_VITE_HMR) {
      this.#currentNuxt.hooks.hook('vite:extend', ({ config }) => {
        if (config.server) {
          attachViteHmrServer(config.server, this.listener.server)
        }
      })
    }

    this.#currentNuxt.hooks.hookOnce('close', () => {
      this.#closeWebSocketConnections()
      this.listener.server.removeAllListeners('upgrade')
    })

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
        debug(`Clearing ${this.#currentNuxt.options.buildDir} (manifest hash ${previousManifest._hash} -> ${newManifest._hash}).`)
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
        const baseURL = nuxt.options.app.baseURL.startsWith('./') ? nuxt.options.app.baseURL.slice(1) : nuxt.options.app.baseURL
        const assetsDir = nuxt.options.app.buildAssetsDir
        const viteHmrPath = `${baseURL.replace(/\/$/, '')}/${assetsDir.replace(/^\//, '')}`
        if (req.url?.startsWith(viteHmrPath)) {
          return // Skip for Vite HMR
        }
        nuxt.server.upgrade(req, socket as any, head)

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

    if (this.listener.https && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.NODE_EXTRA_CA_CERTS) {
      const caRoot = this.listener.https.caRoot
      logger.warn(caRoot
        ? `Node does not read your system trust store, so requests to this server from Node will not trust its certificate.\n       Set \`NODE_EXTRA_CA_CERTS=${join(caRoot, 'rootCA.pem')}\` to fix that.`
        : 'Node does not read your system trust store, so requests to this server from Node will not trust its certificate.\n       Set `NODE_EXTRA_CA_CERTS` to the certificate authority that issued it, or install `mkcert` for a locally-trusted certificate.')
    }

    const kit = await loadKit(this.options.cwd)
    this.#progress.setPhase('types')
    // ensure tsconfigs exist before starting the dev server (vite relies on in the initialisation stage)
    const typesPromise = existsSync(join(this.#currentNuxt.options.buildDir, 'tsconfig.json'))
      ? kit.writeTypes(this.#currentNuxt).catch(console.error)
      : await kit.writeTypes(this.#currentNuxt).catch(console.error)

    await Promise.all([typesPromise, kit.buildNuxt(this.#currentNuxt)])

    if (!this.#currentNuxt.server) {
      throw new Error('Nitro server has not been initialized.')
    }

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
      parentPid: devForkParentPid(),
      port: addr.port,
      hostname: addr.address,
      url: serverUrl,
    })

    this.#progress.setReady()
    this.emit('ready', serverUrl)
  }

  async close(): Promise<void> {
    if (this.#currentNuxt) {
      await this.#currentNuxt.close()
    }
  }

  /** Release the lock file. Call only on final shutdown, not during reloads. */
  releaseLock(): void {
    const takenOverBy = this.#lockedBuildDir && getTakeoverPid(this.#lockedBuildDir)
    if (takenOverBy) {
      writeNotice(`Handed over to another \`nuxt dev\` (PID ${takenOverBy}).`)
    }
    this.#lockCleanup?.()
    this.#lockCleanup = undefined
    this.#lockedBuildDir = undefined
  }

  #acquireDevLock(buildDir: string): void {
    const lock = acquireLock(buildDir, {
      command: 'dev',
      cwd: this.options.cwd,
      parentPid: devForkParentPid(),
    }, {
      // During a handover the outgoing dev server still holds the lock until
      // this process is ready to serve.
      takeoverFrom: this.options.handoverFrom,
    })
    if (lock.existing) {
      throw new ActionableError(formatLockError(lock.existing))
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
    this.#progress.start(this.#loadingMessage, !!reload)
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

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/**
 * Config the CLI injects on behalf of the live listener.
 *
 * Everything returned here is confined to `vite.server` and `devServer`, which
 * Vite leaves out of its dependency optimiser hash. A port-derived or per-run
 * value anywhere else would re-optimise dependencies on every start.
 */
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

  // `defu` concatenates arrays, so the hostname and the listener urls overlap.
  const allowedHosts = defaultConfig.vite?.server?.allowedHosts
  if (Array.isArray(allowedHosts)) {
    defaultConfig.vite!.server!.allowedHosts = dedupe(allowedHosts)
  }
  const corsOrigin = defaultConfig.devServer?.cors?.origin
  if (Array.isArray(corsOrigin)) {
    defaultConfig.devServer!.cors!.origin = dedupe(corsOrigin)
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

/**
 * Collapse the burst of watcher events a single save produces into one call per
 * file. A truncate-then-write save is briefly observable as an empty file, and
 * evaluating it mid-write would report a spurious change.
 */
export function perFile(handler: (file: string) => void, delay = 30): { listener: (event: unknown, file: string | null) => void, cancel: () => void } {
  const timers = new Map<string, NodeJS.Timeout>()
  return {
    listener: (_event, file) => {
      if (!file) {
        return
      }
      clearTimeout(timers.get(file))
      const timer = setTimeout(() => {
        timers.delete(file)
        handler(file)
      }, delay)
      timer.unref?.()
      timers.set(file, timer)
    },
    cancel: () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    },
  }
}

function watchConfigDir(dir: string, onReload: (path: string) => void, onFile?: (file: string, path: string) => void) {
  const fileWatcher = new FileChangeTracker()
  fileWatcher.prime(dir)
  const watcher = watch(dir)
  let configDirWatcher = existsSync(join(dir, '.config')) ? createConfigDirWatcher(dir, onReload) : undefined

  const { listener, cancel } = perFile((file) => {
    if (!fileWatcher.shouldEmitChange(resolve(dir, file))) {
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
  watcher.on('change', listener)

  return () => {
    cancel()
    watcher.close()
    configDirWatcher?.()
  }
}

function createConfigDirWatcher(cwd: string, onReload: (path: string) => void) {
  const configDir = join(cwd, '.config')
  const fileWatcher = new FileChangeTracker()

  fileWatcher.prime(configDir)
  const configDirWatcher = watch(configDir)
  const { listener, cancel } = perFile((file) => {
    if (!fileWatcher.shouldEmitChange(resolve(configDir, file))) {
      return
    }

    if (RESTART_RE.test(file)) {
      onReload(resolve(configDir, file))
    }
  })
  configDirWatcher.on('change', listener)

  return () => {
    cancel()
    configDirWatcher.close()
  }
}

function isPublicHostname(hostname: string | undefined): boolean {
  return !!hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname)
}
