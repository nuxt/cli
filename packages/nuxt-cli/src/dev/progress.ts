import type { IncomingMessage, ServerResponse } from 'node:http'

/** Path prefix reserved for the CLI's own dev-time endpoints. */
const DEV_INTERNAL_PREFIX: string = '/__nuxt_dev__/'
export const PROGRESS_PATH: string = `${DEV_INTERNAL_PREFIX}progress`
const HEARTBEAT_INTERVAL = 15_000

interface DevPhase {
  id: string
  message: string
}

/**
 * Startup phases, in the order they are reached. The index doubles as the
 * progress fraction shown to clients, so the list is deliberately coarse and
 * monotonic: a phase is never re-entered during a single load.
 */
const DEV_PHASES: readonly DevPhase[] = [
  { id: 'config', message: 'Loading Nuxt config' },
  { id: 'modules', message: 'Setting up modules' },
  { id: 'app', message: 'Preparing app' },
  { id: 'types', message: 'Generating types' },
  { id: 'bundle', message: 'Bundling app' },
  { id: 'server', message: 'Building server' },
  { id: 'ready', message: 'Ready' },
]

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'bundle',
  'vite:serverCreated': 'bundle',
  'webpack:compile': 'bundle',
  'nitro:build:before': 'server',
}

export type DevProgressStatus = 'loading' | 'ready' | 'error'

interface DevPhaseTiming {
  phase: string
  message: string
  duration: number
}

export interface DevProgressSnapshot {
  status: DevProgressStatus
  phase: string
  message: string
  index: number
  total: number
  progress: number
  elapsed: number
  reload: boolean
  timings: DevPhaseTiming[]
  error?: { name: string, message: string }
}

interface HookableLike {
  beforeEach?: (fn: (event: { name: string }) => void) => void
}

/**
 * Tracks how far a `nuxt dev` load has got and fans that out to the terminal
 * reporter and to any loading pages connected over SSE.
 */
export class DevProgress {
  #clients = new Set<ServerResponse>()
  #listeners = new Set<(snapshot: DevProgressSnapshot) => void>()
  #heartbeat?: NodeJS.Timeout

  #index = 0
  #message = DEV_PHASES[0]!.message
  #status: DevProgressStatus = 'loading'
  #error?: Error
  #startedAt = Date.now()
  #phaseStartedAt = Date.now()
  #timings: DevPhaseTiming[] = []
  #reload = false

  get snapshot(): DevProgressSnapshot {
    const phase = DEV_PHASES[this.#index]!
    return {
      status: this.#status,
      phase: phase.id,
      message: this.#message,
      index: this.#index,
      total: DEV_PHASES.length - 1,
      progress: this.#status === 'ready' ? 1 : this.#index / (DEV_PHASES.length - 1),
      elapsed: Date.now() - this.#startedAt,
      reload: this.#reload,
      timings: this.#timings,
      error: this.#error && { name: this.#error.name, message: this.#error.message },
    }
  }

  get timings(): DevPhaseTiming[] {
    return this.#timings
  }

  onUpdate(listener: (snapshot: DevProgressSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(message?: string, reload = false): void {
    this.#index = 0
    this.#status = 'loading'
    this.#error = undefined
    this.#timings = []
    this.#reload = reload
    this.#startedAt = Date.now()
    this.#phaseStartedAt = this.#startedAt
    this.#message = message || DEV_PHASES[0]!.message
    this.#emit()
  }

  setMessage(message: string): void {
    if (this.#status === 'error') {
      return
    }
    this.#message = message
    this.#emit()
  }

  setPhase(id: string, message?: string): void {
    this.#advance(id, message, true)
  }

  setReady(): void {
    if (this.#status === 'ready') {
      return
    }
    this.#advance('ready', undefined, false)
    this.#status = 'ready'
    this.#error = undefined
    this.#emit()
  }

  #advance(id: string, message: string | undefined, emit: boolean): void {
    const index = DEV_PHASES.findIndex(phase => phase.id === id)
    if (index === -1 || index < this.#index || this.#status === 'error') {
      return
    }
    const advanced = index > this.#index
    if (advanced) {
      const previous = DEV_PHASES[this.#index]!
      this.#timings.push({
        phase: previous.id,
        message: previous.message,
        duration: Date.now() - this.#phaseStartedAt,
      })
      this.#phaseStartedAt = Date.now()
      this.#index = index
    }
    const next = message || DEV_PHASES[index]!.message
    if (!advanced && next === this.#message) {
      return
    }
    this.#message = next
    if (emit) {
      this.#emit()
    }
  }

  setError(error: Error): void {
    this.#error = error
    this.#status = 'error'
    this.#message = error.message || 'Nuxt failed to start.'
    this.#emit()
  }

  /**
   * Derive phases from the hooks Nuxt calls, so the granularity follows the
   * project's own build rather than a schedule guessed by the CLI.
   */
  attachNuxt(hooks: HookableLike): void {
    // Phase tracking is a nicety: a Nuxt whose hooks cannot be observed still
    // gets a loading page, it just does not advance through the phases.
    hooks.beforeEach?.(({ name }) => {
      const phase = HOOK_PHASES[name]
      if (phase) {
        this.setPhase(phase)
      }
    })
  }

  handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url || '').split('?')[0]
    if (path !== PROGRESS_PATH) {
      return false
    }
    this.#subscribe(res)
    return true
  }

  #subscribe(res: ServerResponse): void {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write('retry: 1000\n\n')

    this.#clients.add(res)
    res.once('close', () => {
      this.#clients.delete(res)
      if (this.#clients.size === 0) {
        clearInterval(this.#heartbeat)
        this.#heartbeat = undefined
      }
    })

    if (!this.#heartbeat) {
      this.#heartbeat = setInterval(() => {
        for (const client of this.#clients) {
          client.write(': ping\n\n')
        }
      }, HEARTBEAT_INTERVAL)
      this.#heartbeat.unref?.()
    }

    this.#send(res, this.snapshot)
  }

  close(): void {
    clearInterval(this.#heartbeat)
    this.#heartbeat = undefined
    for (const client of this.#clients) {
      client.end()
    }
    this.#clients.clear()
  }

  #emit(): void {
    const snapshot = this.snapshot
    for (const listener of this.#listeners) {
      listener(snapshot)
    }
    for (const client of this.#clients) {
      this.#send(client, snapshot)
    }
  }

  #send(res: ServerResponse, snapshot: DevProgressSnapshot): void {
    if (res.writableEnded) {
      return
    }
    res.write(`event: nuxt:${snapshot.status}\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }
}
