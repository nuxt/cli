import type { Phase, PhaseTiming, ProgressMeter, ProgressSnapshot } from './progress-snapshot'

import { PhaseTimeline } from './progress-snapshot'

/**
 * The phases that run one after the other before anything is bundled. The last
 * one covers the rest of the build, in which bundles and prerendering are
 * tracked as tasks of their own, since they can overlap.
 */
const BUILD_PHASES: readonly Phase[] = [
  { id: 'config', message: 'Loading Nuxt config' },
  { id: 'modules', message: 'Setting up modules' },
  { id: 'app', message: 'Preparing app' },
  { id: 'types', message: 'Generating types' },
  { id: 'build', message: 'Building' },
]

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'build',
}

const BUILD_PHASE = 'build'
const PRERENDER_TASK = 'prerender'

interface HookableLike {
  beforeEach?: (fn: (event: { name: string, args?: unknown[] }) => void) => void
}

interface NuxtLike {
  hooks?: HookableLike
}

interface Task {
  start: number
  end?: number
}

function listLabels(labels: string[]): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
    : labels[0]!
}

/**
 * Tracks how far a production build has got, so the same transient phase line
 * `nuxt dev` shows can report `nuxt build`, and the completion summary can list
 * where the time went.
 */
export class BuildProgress extends PhaseTimeline {
  #message = BUILD_PHASES[0]!.message
  #finished = false
  #tasks = new Map<string, Task>()
  #active: string[] = []
  #key = BUILD_PHASE
  #prerender: ProgressMeter = { done: 0, total: 0 }
  #phaseTimings: PhaseTiming[] = []

  constructor() {
    super(BUILD_PHASES)
  }

  override get snapshot(): ProgressSnapshot {
    const snapshot = {
      ...super.snapshot,
      phase: this.#key,
      message: this.#message,
    }
    return this.#prerendering
      ? {
          ...snapshot,
          meter: { ...this.#prerender },
        }
      : snapshot
  }

  override onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    const off = super.onUpdate(listener)
    listener(this.snapshot)
    return off
  }

  setPhase(id: string): void {
    if (this.#finished || !this.enter(id)) {
      return
    }
    this.#key = id
    this.#setMessage(BUILD_PHASES[this.index]!.message)
  }

  /** Start bundling `label`, such as `client`, alongside anything else in flight. */
  startBundle(label: string): void {
    this.#startTask(label)
  }

  endBundle(label: string): void {
    this.#endTask(label)
  }

  /** Start prerendering the `total` routes known up front. */
  startPrerender(total = 0): void {
    this.#prerender = { done: 0, total }
    this.#startTask(PRERENDER_TASK)
  }

  /** Count a route as done, out of the `total` known so far. */
  prerenderRoute(route: string, total = 0): void {
    if (this.#finished) {
      return
    }
    const done = this.#prerender.done + 1
    this.#prerender = {
      done,
      total: Math.max(total, this.#prerender.total, done),
      detail: route,
    }
    if (this.#prerendering) {
      this.emit()
    }
  }

  endPrerender(): void {
    this.#endTask(PRERENDER_TASK)
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
    const now = Date.now()
    const building = BUILD_PHASES[this.index]!.id === BUILD_PHASE
    this.closePhase()
    this.#finished = true
    this.#phaseTimings = [...this.timings]
    if (!building || !this.#tasks.size) {
      return
    }
    // The build phase is only the span the tasks ran in; each task reports its own.
    this.timings.pop()
    const tasks: PhaseTiming[] = [...this.#tasks].map(([id, task]) => ({
      phase: id,
      message: id,
      start: task.start - this.startedAt,
      duration: (task.end ?? now) - task.start,
    }))
    this.timings.push(...tasks.sort((a, b) => a.start! - b.start!))
  }

  /**
   * The phases alone once the build has finished, with bundling and
   * prerendering as the one `build` span they ran in.
   */
  get phaseTimings(): PhaseTiming[] {
    return this.#phaseTimings
  }

  /**
   * Derive phases from the hooks Nuxt calls, so the timeline follows the
   * project's own build rather than a schedule guessed by the CLI.
   */
  attachNuxt(nuxt: NuxtLike): void {
    nuxt.hooks?.beforeEach?.(({ name }) => {
      const phase = HOOK_PHASES[name]
      if (phase) {
        this.setPhase(phase)
      }
    })
  }

  get #prerendering(): boolean {
    return !this.#finished && this.#active.includes(PRERENDER_TASK)
  }

  #startTask(id: string): void {
    if (this.#finished) {
      return
    }
    if (this.enter(BUILD_PHASE)) {
      this.#key = BUILD_PHASE
    }
    this.#tasks.set(id, {
      start: Date.now(),
    })
    this.#active = [
      ...this.#active.filter(active => active !== id),
      id,
    ]
    this.#update()
  }

  #endTask(id: string): void {
    const task = this.#tasks.get(id)
    if (this.#finished || !task || task.end !== undefined) {
      return
    }
    task.end = Date.now()
    this.#active = this.#active.filter(active => active !== id)
    this.#update()
  }

  #update(): void {
    if (this.#finished || !this.#active.length) {
      // Between tasks the line keeps its phase, so a pipe is not handed a
      // line for every gap between one bundle and the next.
      this.#setMessage(BUILD_PHASES.at(-1)!.message)
      return
    }
    if (this.#active.includes(PRERENDER_TASK)) {
      this.#key = PRERENDER_TASK
      this.#setMessage('Prerendering routes')
      return
    }
    this.#key = `bundle:${this.#active.join('+')}`
    this.#setMessage(`Bundling ${listLabels(this.#active)}`)
  }

  #setMessage(message: string): void {
    if (this.#finished || message === this.#message) {
      return
    }
    this.#message = message
    this.emit()
  }
}
