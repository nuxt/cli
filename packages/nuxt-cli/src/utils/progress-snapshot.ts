/**
 * What a command reports about its own progress. Shared by `nuxt dev`, whose
 * loading page and TUI panel render it, and `nuxt build`, which only shows the
 * phase line, so a snapshot carries fields a given command never sets.
 */

export type ProgressStatus = 'loading' | 'ready' | 'error'

/**
 * The message of the phase a command ends in, so a reporter can tell a phase
 * label from narration about what the phase is still waiting on.
 */
export const READY_MESSAGE: string = 'Ready'

export interface PendingRender {
  /** How the request reads to a user, e.g. `GET /about`. */
  label: string
  /** When it arrived, so a consumer can tick the elapsed time itself. */
  startedAt: number
}

export interface PhaseTiming {
  phase: string
  message: string
  duration: number
}

export interface ProgressSnapshot {
  status: ProgressStatus
  phase: string
  message: string
  index: number
  total: number
  progress: number
  elapsed: number
  /**
   * How long the current phase has been running. A phase can hold a command for
   * most of its run, so this is what tells a UI that a still label is still
   * making progress rather than stuck.
   */
  phaseElapsed: number
  reload: boolean
  /**
   * Whether a request has actually been answered. `status` is `ready` from the
   * moment the server is listening, so this is what tells a UI whether the app
   * can be used yet. Always true for a command that only builds.
   */
  serving: boolean
  /**
   * The request the server is busy with, once it has been busy long enough to
   * be worth reporting. This is the only thing that happens between `ready` and
   * the first page appearing, and on a cold start it is the longest wait of the
   * whole load. Never set by a command that only builds.
   */
  pending?: PendingRender
  timings: PhaseTiming[]
  error?: { name: string, message: string }
}

export interface Phase {
  id: string
  message: string
}

/** Forward-only sequence of phases, timing each as it is left. */
export class PhaseTimeline {
  timings: PhaseTiming[] = []
  protected index: number = 0
  protected startedAt: number = Date.now()
  protected phaseStartedAt: number = this.startedAt
  protected readonly phases: readonly Phase[]
  #listeners = new Set<(snapshot: ProgressSnapshot) => void>()

  constructor(phases: readonly Phase[]) {
    this.phases = phases
  }

  get snapshot(): ProgressSnapshot {
    const now = Date.now()
    return {
      status: 'loading',
      phase: this.phases[this.index]!.id,
      message: this.phases[this.index]!.message,
      index: this.index,
      total: this.phases.length - 1,
      progress: this.index / (this.phases.length - 1),
      elapsed: now - this.startedAt,
      phaseElapsed: now - this.phaseStartedAt,
      reload: false,
      serving: true,
      timings: this.timings,
    }
  }

  onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  protected restart(): void {
    this.index = 0
    this.timings = []
    this.startedAt = Date.now()
    this.phaseStartedAt = this.startedAt
  }

  protected closePhase(): void {
    const phase = this.phases[this.index]!
    this.timings.push({ phase: phase.id, message: phase.message, duration: Date.now() - this.phaseStartedAt })
    this.phaseStartedAt = Date.now()
  }

  /** Enter phase `id`; `undefined` if unknown or already passed. */
  protected enter(id: string): boolean | undefined {
    const index = this.phases.findIndex(phase => phase.id === id)
    if (index === -1 || index < this.index) {
      return undefined
    }
    if (index === this.index) {
      return false
    }
    this.closePhase()
    this.index = index
    return true
  }

  protected emit(): ProgressSnapshot {
    const snapshot = this.snapshot
    for (const listener of this.#listeners) {
      listener(snapshot)
    }
    return snapshot
  }
}
