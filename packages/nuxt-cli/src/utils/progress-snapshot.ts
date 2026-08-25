/**
 * What a command reports about its own progress. Shared by `nuxt dev`, whose
 * loading page and TUI panel render it, and `nuxt build`, which only shows the
 * phase line, so a snapshot carries fields a given command never sets.
 */

export type ProgressStatus = 'loading' | 'ready' | 'error'

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
  timings: PhaseTiming[]
  error?: { name: string, message: string }
}
