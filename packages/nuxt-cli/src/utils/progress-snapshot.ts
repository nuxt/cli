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
