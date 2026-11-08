import type { Phase, ProgressSnapshot } from './progress-snapshot'

import { PhaseTimeline } from './progress-snapshot'

/**
 * Build phases, in the order they are reached. A phase is never re-entered, so
 * the index only ever moves forward and the breakdown printed at the end lists
 * each phase once.
 */
const BUILD_PHASES: readonly Phase[] = [
  { id: 'config', message: 'Loading Nuxt config' },
  { id: 'modules', message: 'Setting up modules' },
  { id: 'app', message: 'Preparing app' },
  { id: 'types', message: 'Generating types' },
  { id: 'app (client)', message: 'Building app (client)' },
  { id: 'app (server)', message: 'Building app (server)' },
  { id: 'server (nitro)', message: 'Building server (nitro)' },
]

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'app (client)',
  'nitro:build:before': 'server (nitro)',
}

/** Nitro builds on its own hooks, which Nuxt's never see. */
const NITRO_INIT_HOOK = 'nitro:init'

/**
 * Nitro's own hooks, relabelled. Without these the Nitro phase says nothing
 * between the bundle starting and the output being written, which on a large
 * project is the longest silence of the build.
 */
const NITRO_MESSAGES: Record<string, string> = {
  'rollup:before': 'Bundling server (nitro)',
  'prerender:routes': 'Prerendering routes',
}

const PRERENDER_HOOK = 'prerender:generate'
const PRERENDERED_HOOK = 'prerender:route'

interface HookableLike {
  beforeEach?: (fn: (event: { name: string, args?: unknown[] }) => void) => void
}

interface NuxtLike {
  options?: { experimental?: { nitroViteEnvironment?: boolean } }
  hook?: (name: 'vite:extendConfig', fn: (config: { plugins?: unknown[] }) => void) => unknown
  hooks?: HookableLike
}

/** Names the Vite plugin that reports which environment is being built, so it is added once per config. */
const VITE_PLUGIN_NAME = 'nuxi:build-progress'

/** The Vite environment Nitro 3 builds the server in. */
const NITRO_ENVIRONMENT = 'nitro'

/**
 * Tracks how far a production build has got, so the same transient phase line
 * `nuxt dev` shows can report `nuxt build`, and the completion summary can list
 * where the time went.
 */
export class BuildProgress extends PhaseTimeline {
  #message = BUILD_PHASES[0]!.message
  #finished = false
  /** Routes written so far, the one measure of how far prerendering has got. */
  #prerendered = 0

  constructor() {
    super(BUILD_PHASES)
  }

  override get snapshot(): ProgressSnapshot {
    return { ...super.snapshot, message: this.#message }
  }

  override onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    const off = super.onUpdate(listener)
    listener(this.snapshot)
    return off
  }

  setPhase(id: string, message?: string): void {
    if (this.#finished || this.enter(id) === undefined) {
      return
    }
    this.setMessage(message || BUILD_PHASES[this.index]!.message)
  }

  setMessage(message: string): void {
    if (this.#finished || message === this.#message) {
      return
    }
    this.#message = message
    this.emit()
  }

  /**
   * Close the phase in flight and stop accepting updates, so its duration makes
   * it into the breakdown. Nothing is emitted: whoever reports the build owns
   * what is said about it finishing.
   */
  finish(): void {
    if (!this.#finished) {
      this.closePhase()
      this.#finished = true
    }
  }

  /**
   * Derive phases from the hooks Nuxt and Nitro call, so the timeline follows
   * the project's own build rather than a schedule guessed by the CLI.
   */
  attachNuxt(nuxt: NuxtLike): void {
    // Vite configs resolve before anything is bundled, and with the environment
    // API (which a server builder such as `@nuxt/vite-server` can switch on during
    // setup) one config builds both environments. Only the build itself knows
    // which environment it has reached.
    nuxt.hook?.('vite:extendConfig', (config) => {
      if (config.plugins && !config.plugins.some(plugin => (plugin as { name?: string } | null)?.name === VITE_PLUGIN_NAME)) {
        config.plugins.push(this.#vitePlugin())
      }
    })
    nuxt.hooks?.beforeEach?.(({ name, args }) => {
      const phase = HOOK_PHASES[name]
      // Nitro 3 can build as a Vite environment, after the app, and is then
      // reported by the Vite plugin when its environment starts.
      if (phase && !(name === 'nitro:build:before' && nuxt.options?.experimental?.nitroViteEnvironment)) {
        this.setPhase(phase)
        return
      }
      if (phase) {
        return
      }
      if (name === 'webpack:compile') {
        const ctx = args?.[0] as { name?: string } | undefined
        this.setPhase(ctx?.name === 'server' ? 'app (server)' : 'app (client)')
      }
      else if (name === NITRO_INIT_HOOK) {
        this.#attachNitro((args?.[0] as { hooks?: HookableLike } | undefined)?.hooks)
      }
    })
  }

  #vitePlugin() {
    let ssr = false
    const setPhase = (id: string) => this.setPhase(id)
    return {
      name: VITE_PLUGIN_NAME,
      apply: 'build' as const,
      // Before Vite 6 each environment has a config of its own.
      configResolved(config: { build?: { ssr?: unknown } }) {
        ssr = !!config.build?.ssr
      },
      buildStart(this: { environment?: { name: string, config?: { consumer?: string } } }) {
        if (this.environment?.name === NITRO_ENVIRONMENT) {
          setPhase('server (nitro)')
          return
        }
        const consumer = this.environment?.config?.consumer ?? (ssr ? 'server' : 'client')
        setPhase(consumer === 'server' ? 'app (server)' : 'app (client)')
      },
    }
  }

  #attachNitro(hooks: HookableLike | undefined): void {
    hooks?.beforeEach?.(({ name, args }) => {
      // Nitro's hooks also run while Nuxt is still bundling the app, and those
      // are not what the build is waiting on.
      if (BUILD_PHASES[this.index]!.id !== 'server (nitro)') {
        return
      }
      const message = NITRO_MESSAGES[name]
      if (message) {
        this.setMessage(message)
      }
      else if (name === PRERENDER_HOOK) {
        const route = (args?.[0] as { route?: string } | undefined)?.route
        if (route) {
          this.setMessage(this.#prerendered ? `Prerendering ${route} (${this.#prerendered} done)` : `Prerendering ${route}`)
        }
      }
      else if (name === PRERENDERED_HOOK) {
        this.#prerendered++
      }
    })
  }
}
