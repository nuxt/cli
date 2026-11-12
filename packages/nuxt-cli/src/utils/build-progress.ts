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
  { id: 'bundle (client)', message: 'Bundling client' },
  { id: 'bundle (server)', message: 'Bundling server' },
  { id: 'prerender', message: 'Prerendering routes' },
  { id: 'bundle (nitro)', message: 'Bundling nitro' },
]

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'bundle (client)',
}

/** Nitro builds on its own hooks, which Nuxt's never see. */
const NITRO_INIT_HOOK = 'nitro:init'
const NITRO_BUILD_HOOK = 'nitro:build:before'

const PRERENDER_HOOK = 'prerender:generate'
const PRERENDERED_HOOK = 'prerender:route'

/** The Vite environment Nitro 3 builds the server in. */
const NITRO_ENVIRONMENT = 'nitro'

interface HookableLike {
  beforeEach?: (fn: (event: { name: string, args?: unknown[] }) => void) => void
}

interface NuxtLike {
  options?: { experimental?: { nitroViteEnvironment?: boolean } }
  hooks?: HookableLike
}

/** A Vite environment as it starts building. */
export interface BuildEnvironment {
  name?: string
  consumer?: string
}

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
   * Move to the bundle phase of a Vite environment that has started building.
   * Vite resolves every config before it bundles anything, and with the
   * environment API one config builds them all, so only the build itself knows
   * which one it has reached.
   */
  enterEnvironment({ name, consumer }: BuildEnvironment): void {
    if (name === NITRO_ENVIRONMENT) {
      this.setPhase('bundle (nitro)')
      return
    }
    this.setPhase(consumer === 'server' ? 'bundle (server)' : 'bundle (client)')
  }

  /**
   * Derive phases from the hooks Nuxt and Nitro call, so the timeline follows
   * the project's own build rather than a schedule guessed by the CLI.
   */
  attachNuxt(nuxt: NuxtLike): void {
    let nitroBuilding = false
    nuxt.hooks?.beforeEach?.(({ name, args }) => {
      const phase = HOOK_PHASES[name]
      if (phase) {
        this.setPhase(phase)
      }
      else if (name === NITRO_BUILD_HOOK) {
        nitroBuilding = true
      }
      else if (name === 'webpack:compile') {
        const ctx = args?.[0] as { name?: string } | undefined
        this.setPhase(ctx?.name === 'server' ? 'bundle (server)' : 'bundle (client)')
      }
      else if (name === NITRO_INIT_HOOK) {
        // Nitro's hooks also run while Nuxt is still bundling the app, and those
        // are not what the build is waiting on.
        const hooks = (args?.[0] as { hooks?: HookableLike } | undefined)?.hooks
        hooks?.beforeEach?.(event => nitroBuilding && this.#onNitroHook(event, !!nuxt.options?.experimental?.nitroViteEnvironment))
      }
    })
  }

  #onNitroHook({ name, args }: { name: string, args?: unknown[] }, viteEnvironment: boolean): void {
    if (name === 'prerender:init') {
      this.setPhase('prerender')
    }
    // Nitro 2 bundles with Rollup; Nitro 3 as a Vite environment, reported
    // through `enterEnvironment`, and runs its Rollup hooks early.
    else if (name === 'rollup:before' && !viteEnvironment) {
      this.setPhase('bundle (nitro)')
    }
    else if (name === PRERENDER_HOOK && BUILD_PHASES[this.index]!.id === 'prerender') {
      const route = (args?.[0] as { route?: string } | undefined)?.route
      if (route) {
        this.setMessage(this.#prerendered ? `Prerendering ${route} (${this.#prerendered} done)` : `Prerendering ${route}`)
      }
    }
    else if (name === PRERENDERED_HOOK) {
      this.#prerendered++
    }
  }
}
