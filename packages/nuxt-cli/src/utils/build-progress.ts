import type { PhaseTiming, ProgressSnapshot } from './progress-snapshot'

interface BuildPhase {
  id: string
  message: string
}

/**
 * Build phases, in the order they are reached. A phase is never re-entered, so
 * the index only ever moves forward and the breakdown printed at the end lists
 * each phase once.
 */
const BUILD_PHASES: readonly BuildPhase[] = [
  { id: 'config', message: 'Loading Nuxt config' },
  { id: 'modules', message: 'Setting up modules' },
  { id: 'app', message: 'Preparing app' },
  { id: 'types', message: 'Generating types' },
  { id: 'client', message: 'Bundling client' },
  { id: 'server', message: 'Bundling server' },
  { id: 'nitro', message: 'Building Nitro server' },
]

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'client',
  'nitro:build:before': 'nitro',
}

/** Nitro builds on its own hooks, which Nuxt's never see. */
const NITRO_INIT_HOOK = 'nitro:init'

/**
 * Nitro's own hooks, relabelled. Without these the Nitro phase says nothing
 * between the bundle starting and the output being written, which on a large
 * project is the longest silence of the build.
 */
const NITRO_MESSAGES: Record<string, string> = {
  'rollup:before': 'Bundling Nitro server',
  'prerender:routes': 'Prerendering routes',
}

const PRERENDER_HOOK = 'prerender:generate'

interface HookableLike {
  beforeEach?: (fn: (event: { name: string, args?: unknown[] }) => void) => void
}

interface NuxtLike {
  options?: { experimental?: { viteEnvironmentApi?: boolean } }
  hooks?: HookableLike
}

/**
 * Tracks how far a production build has got, so the same transient phase line
 * `nuxt dev` shows can report `nuxt build`, and the completion summary can list
 * where the time went.
 */
export class BuildProgress {
  #listeners = new Set<(snapshot: ProgressSnapshot) => void>()
  #index = 0
  #message = BUILD_PHASES[0]!.message
  #startedAt = Date.now()
  #phaseStartedAt = Date.now()
  #timings: PhaseTiming[] = []
  #finished = false
  /**
   * With the Vite environment API a single build covers both environments, so
   * the client and server configs resolve up front and cannot mark the boundary
   * between them.
   */
  #splitBundles = true

  get snapshot(): ProgressSnapshot {
    const phase = BUILD_PHASES[this.#index]!
    return {
      status: 'loading',
      phase: phase.id,
      message: this.#message,
      index: this.#index,
      total: BUILD_PHASES.length - 1,
      progress: this.#index / (BUILD_PHASES.length - 1),
      elapsed: Date.now() - this.#startedAt,
      phaseElapsed: Date.now() - this.#phaseStartedAt,
      reload: false,
      serving: true,
      timings: this.#timings,
    }
  }

  get timings(): PhaseTiming[] {
    return this.#timings
  }

  onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    this.#listeners.add(listener)
    listener(this.snapshot)
    return () => this.#listeners.delete(listener)
  }

  setPhase(id: string, message?: string): void {
    const index = BUILD_PHASES.findIndex(phase => phase.id === id)
    if (this.#finished || index === -1 || index < this.#index) {
      return
    }
    if (index > this.#index) {
      const previous = BUILD_PHASES[this.#index]!
      this.#timings.push({
        phase: previous.id,
        message: previous.message,
        duration: Date.now() - this.#phaseStartedAt,
      })
      this.#phaseStartedAt = Date.now()
      this.#index = index
    }
    this.setMessage(message || BUILD_PHASES[index]!.message)
  }

  setMessage(message: string): void {
    if (this.#finished || message === this.#message) {
      return
    }
    this.#message = message
    this.#emit()
  }

  /**
   * Close the phase in flight and stop accepting updates, so its duration makes
   * it into the breakdown. Nothing is emitted: whoever reports the build owns
   * what is said about it finishing.
   */
  finish(): void {
    if (this.#finished) {
      return
    }
    const phase = BUILD_PHASES[this.#index]!
    this.#timings.push({
      phase: phase.id,
      message: phase.message,
      duration: Date.now() - this.#phaseStartedAt,
    })
    this.#finished = true
  }

  /**
   * Derive phases from the hooks Nuxt and Nitro call, so the timeline follows
   * the project's own build rather than a schedule guessed by the CLI.
   */
  attachNuxt(nuxt: NuxtLike): void {
    this.#splitBundles = !nuxt.options?.experimental?.viteEnvironmentApi
    nuxt.hooks?.beforeEach?.(({ name, args }) => {
      const phase = HOOK_PHASES[name]
      if (phase) {
        this.setPhase(phase, phase === 'client' && !this.#splitBundles ? 'Bundling app' : undefined)
        return
      }
      if (name === 'vite:configResolved' && this.#splitBundles) {
        const ctx = args?.[1] as { isServer?: boolean } | undefined
        this.setPhase(ctx?.isServer ? 'server' : 'client')
      }
      else if (name === 'webpack:compile') {
        const ctx = args?.[0] as { name?: string } | undefined
        this.setPhase(ctx?.name === 'server' ? 'server' : 'client')
      }
      else if (name === NITRO_INIT_HOOK) {
        this.#attachNitro((args?.[0] as { hooks?: HookableLike } | undefined)?.hooks)
      }
    })
  }

  #attachNitro(hooks: HookableLike | undefined): void {
    hooks?.beforeEach?.(({ name, args }) => {
      // Nitro's hooks also run while Nuxt is still bundling the app, and those
      // are not what the build is waiting on.
      if (BUILD_PHASES[this.#index]!.id !== 'nitro') {
        return
      }
      const message = NITRO_MESSAGES[name]
      if (message) {
        this.setMessage(message)
      }
      else if (name === PRERENDER_HOOK) {
        const route = (args?.[0] as { route?: string } | undefined)?.route
        if (route) {
          this.setMessage(`Prerendering ${route}`)
        }
      }
    })
  }

  #emit(): void {
    const snapshot = this.snapshot
    for (const listener of this.#listeners) {
      listener(snapshot)
    }
  }
}
