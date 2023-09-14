import type { RequestListener, ServerResponse } from 'node:http'
import EventEmitter from 'node:events'
import { relative, resolve } from 'pathe'
import chokidar from 'chokidar'
import { consola } from 'consola'
import { debounce } from 'perfect-debounce'
import { toNodeListener } from 'h3'
import { HTTPSOptions, listen, Listener } from 'listhen'
import type { Nuxt, NuxtConfig } from '@nuxt/schema'
import { loadKit } from '../utils/kit'
import { loadNuxtManifest, writeNuxtManifest } from '../utils/nuxt'
import { clearBuildDir } from '../utils/fs'
import { importModule } from './esm'

export type NuxtDevIPCMessage =
  | { type: 'nuxt:internal:dev:ready'; port: number }
  | { type: 'nuxt:internal:dev:loading'; message: string }
  | { type: 'nuxt:internal:dev:restart' }

export interface NuxtDevServerOptions {
  cwd: string
  logLevel: 'silent' | 'info' | 'verbose'
  dotenv: boolean
  clear: boolean
  overrides: NuxtConfig
  https?: boolean | HTTPSOptions
  port?: string | number
  loadingTemplate?: ({ loading }: { loading: string }) => string
}

export async function createNuxtDevServer(options: NuxtDevServerOptions) {
  const devServer = new NuxtDevServer(options)
  devServer.listener = await listen(devServer.handler, {
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    showURL: false,
  })
  return devServer
}

const RESTART_RE = /^(nuxt\.config\.(js|ts|mjs|cjs)|\.nuxtignore|\.nuxtrc)$/

class NuxtDevServer extends EventEmitter {
  private _handler?: RequestListener
  private _distWatcher?: chokidar.FSWatcher
  private _currentNuxt?: Nuxt
  private _loadingMessage?: string

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

    this.handler = async (req, res) => {
      await _initPromise
      if (this._handler) {
        this._handler(req, res)
      } else {
        this._renderError(res)
      }
    }

    // @ts-ignore we set it in wrapper function
    this.listener = undefined
  }

  async _renderError(res: ServerResponse, _error?: Error) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html')
    const loadingTemplate =
      this.options.loadingTemplate ||
      this._currentNuxt?.options.devServer.loadingTemplate ||
      (
        await importModule('@nuxt/ui-templates', this.options.cwd).then(
          (r) => r.loading,
        )
      ).catch(() => {}) ||
      ((params: { loading: string }) => `<h2>${params.loading}</h2>`)
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
    } catch (error) {
      consola.error(`Cannot ${reload ? 'restart' : 'start'} nuxt: `, error)
      this._handler = undefined
      this._loadingMessage =
        'Error while loading nuxt. Please check console and fix errors.'
      this.emit('loading', this._loadingMessage)
    }
  }

  async _load(reload?: boolean, reason?: string) {
    const action = reload ? 'Restarting' : 'Starting'
    this._loadingMessage = `${reason ? reason + '. ' : ''}${action} nuxt...`
    this._handler = undefined
    this.emit('loading', this._loadingMessage)
    if (reload) {
      consola.info(this._loadingMessage)
    }

    if (this._currentNuxt) {
      await this._currentNuxt.close()
    }
    if (this._distWatcher) {
      await this._distWatcher.close()
    }

    const kit = await loadKit(this.options.cwd)
    this._currentNuxt = await kit.loadNuxt({
      rootDir: this.options.cwd,
      dev: true,
      ready: false,
      overrides: {
        logLevel: this.options.logLevel as 'silent' | 'info' | 'verbose',
        vite: {
          clearScreen: this.options.clear,
        },
        nitro: {
          devErrorHandler: (error, event) => {
            this._renderError(event.node.res, error)
          },
        },
        ...this.options.overrides,
      },
    })

    // Connect Vite HMR
    this._currentNuxt.hooks.hookOnce(
      'vite:extendConfig',
      (config, { isClient }) => {
        if (isClient && config.server) {
          config.server.hmr = {
            server: this.listener.server,
          }
        }
      },
    )

    // Write manifest and also check if we need cache invalidation
    if (!reload) {
      const previousManifest = await loadNuxtManifest(
        this._currentNuxt.options.buildDir,
      )
      const newManifest = await writeNuxtManifest(this._currentNuxt)
      if (
        previousManifest &&
        newManifest &&
        previousManifest._hash !== newManifest._hash
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
    this._currentNuxt.options.devServer.url = `http://${
      addr.address.includes(':') ? `[${addr.address}]` : addr.address
    }:${addr.port}/`
    this._currentNuxt.options.devServer.https = this.options.https as
      | boolean
      | { key: string; cert: string }

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
    const configWatcher = chokidar.watch([this.options.cwd], {
      ignoreInitial: true,
      depth: 0,
    })
    configWatcher.on('all', (_event, _file) => {
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
