import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PendingRender, PhaseTiming, ProgressSnapshot, ProgressStatus } from '../utils/progress-snapshot'

import { READY_MESSAGE } from '../utils/progress-snapshot'

/** Path prefix reserved for the CLI's own dev-time endpoints. */
export const DEV_INTERNAL_PREFIX: string = '/__nuxt_dev__/'
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
  { id: 'ready', message: READY_MESSAGE },
]

/**
 * Fraction reserved for the first render. `nuxt:ready` means the server can
 * accept a request, not answer one, and compiling the first document is the
 * longest single wait on a large project.
 */
const READY_PROGRESS = 0.95

/** Shown between the server accepting requests and it answering one. */
const WARMUP_MESSAGE = 'Compiling the first request'

/**
 * How long a request has to be in flight before it is reported. A page a dev
 * server has already compiled is answered in milliseconds, and a status line
 * that appears and disappears within a frame is noise.
 */
const REQUEST_DWELL = 400

const HOOK_PHASES: Record<string, string> = {
  'modules:before': 'modules',
  'builder:generateApp': 'app',
  'prepare:types': 'types',
  'build:before': 'bundle',
  'vite:serverCreated': 'bundle',
  'webpack:compile': 'bundle',
  'nitro:build:before': 'server',
}

/** Index of the phase a module count belongs to. */
const MODULES_INDEX = DEV_PHASES.findIndex(phase => phase.id === 'modules')

/**
 * Both carry a `name` that is always renderable. A Nuxt without them shows
 * the phase label, as before.
 */
const MODULE_STARTED = 'module:before'
const MODULE_FINISHED = 'module:done'

/**
 * Nitro builds the server on its own hooks, which Nuxt's never see, so this is
 * the only way the server phase says anything. The prefix keeps a name like
 * `rollup:before` from reading as if Nuxt were the one busy.
 */
const NITRO_HOOK = 'nitro:init'
const NITRO_PREFIX = 'nitro:'

/**
 * How long a module has to stay busy before it is named. Most install in a few
 * milliseconds, and a label flickering through dozens of names a second is
 * worse than a still one, especially as a browser tab title.
 */
const MODULE_DWELL = 150

/**
 * How long any other hook has to run before it is named, set where a hook has
 * stopped being a step of the build and started being the reason for the wait.
 * Nuxt calls thousands of them, nearly all sub-millisecond.
 */
const HOOK_DWELL = 1000

/**
 * How long a single phase has to run before the dwells above are dropped to
 * {@link IMPATIENT_MODULE_DWELL} and {@link IMPATIENT_HOOK_DWELL}. A phase this
 * far in has stopped being described by its own label, so anything concrete is
 * better than a still one, flicker included.
 */
const PHASE_PATIENCE = 3000

const IMPATIENT_MODULE_DWELL = 50
const IMPATIENT_HOOK_DWELL = 150

/** How often the narration looks at what is currently running. */
const NARRATION_INTERVAL = 250

/** Friendlier wording for hooks whose raw name would not explain the wait. */
const HOOK_LABELS: Record<string, string> = {
  'devtools:before': 'Setting up Nuxt DevTools',
  'modules:done': 'Finishing module setup',
  'app:resolve': 'Resolving the app',
  'app:templates': 'Collecting app templates',
  'app:templatesGenerated': 'Writing app templates',
  'pages:extend': 'Scanning pages',
  'pages:resolved': 'Resolving pages',
  'components:dirs': 'Scanning component directories',
  'components:extend': 'Resolving components',
  'imports:extend': 'Resolving auto-imports',
  'imports:sources': 'Collecting auto-imports',
  'schema:extend': 'Extending the config schema',
  'schema:resolved': 'Resolving the config schema',
  'nitro:prepare:types': 'Generating server types',
  'nitro:config': 'Configuring the server',
  'nitro:init': 'Starting the server build',
  'nitro:rollup:before': 'Bundling the server',
  'nitro:compiled': 'Finishing the server build',
  'nitro:dev:reload': 'Reloading the server',
  'nitro:types:extend': 'Generating server types',
  'vite:extendConfig': 'Configuring Vite',
  'vite:configResolved': 'Configuring Vite',
  'vite:serverCreated': 'Starting Vite',
  'webpack:config': 'Configuring webpack',
}

/**
 * Hook namespaces owned by Nuxt, Nitro or a bundler. A name in one of these is
 * an implementation detail: it is narrated only through {@link HOOK_LABELS},
 * because the raw name describes the build's internals rather than the wait.
 * Anything else was named by the project or one of its modules, and reads as
 * something its author would recognise.
 */
const INTERNAL_HOOK_NAMESPACES = new Set(['app', 'build', 'builder', 'components', 'devtools', 'imports', 'kit', 'modules', 'module', 'nitro', 'pages', 'prepare', 'schema', 'vite', 'webpack', 'rspack'])

/**
 * The label for a hook that has been running long enough to be the reason for
 * the wait, or nothing where its name would say less than the phase it is in.
 */
function hookLabel(name: string): string | undefined {
  const label = HOOK_LABELS[name]
  if (label) {
    return label
  }
  return INTERNAL_HOOK_NAMESPACES.has(name.split(':')[0]!) ? undefined : `Running ${name}`
}

/**
 * Past this depth the stack is dropped rather than grown, so a hook that
 * never settles cannot retain an entry for the rest of the load.
 */
const HOOK_STACK_LIMIT = 64

/** Module names share their line with the status badge, and paths get long. */
const MODULE_NAME_LIMIT = 32

/**
 * Local modules keep only their basename; package specifiers, scope included,
 * are left alone.
 */
function shortenModuleName(name: string): string {
  const short = name.startsWith('@') || !/[\\/]/.test(name)
    ? name
    : name.split(/[\\/]/).pop()!.replace(/\.[cm]?[jt]sx?$/, '')
  return short.length > MODULE_NAME_LIMIT ? `${short.slice(0, MODULE_NAME_LIMIT - 1)}\u2026` : short
}

function moduleName(module: unknown): string | undefined {
  const name = (module as { name?: unknown } | undefined)?.name
  return typeof name === 'string' && name ? name : undefined
}

interface HookableLike {
  beforeEach?: (fn: (event: { name: string, args?: unknown[] }) => void) => void
  afterEach?: (fn: (event: { name: string }) => void) => void
}

interface ActiveHook {
  name: string
  at: number
}

/**
 * Tracks how far a `nuxt dev` load has got and fans that out to the terminal
 * reporter and to any loading pages connected over SSE.
 */
export class DevProgress {
  #clients = new Set<ServerResponse>()
  #listeners = new Set<(snapshot: ProgressSnapshot) => void>()
  #heartbeat?: NodeJS.Timeout

  #index = 0
  #message = DEV_PHASES[0]!.message
  #status: ProgressStatus = 'loading'
  #error?: Error
  #startedAt = Date.now()
  #phaseStartedAt = Date.now()
  #timings: PhaseTiming[] = []
  #reload = false
  #baseMessage = DEV_PHASES[0]!.message
  #module?: ActiveHook
  #hooks: ActiveHook[] = []
  #narrating = false
  #serving = false
  #inflight = new Map<number, PendingRender>()
  #pending?: PendingRender
  #dwell?: NodeJS.Timeout
  #nextRequest = 0
  #observing = false
  #installedModules?: () => number
  #observed = new WeakSet<HookableLike>()
  #ticker?: NodeJS.Timeout

  get snapshot(): ProgressSnapshot {
    const phase = DEV_PHASES[this.#index]!
    return {
      status: this.#status,
      phase: phase.id,
      message: this.#message,
      index: this.#index,
      total: DEV_PHASES.length - 1,
      progress: this.#status === 'ready'
        ? (this.#serving ? 1 : READY_PROGRESS)
        : this.#index / (DEV_PHASES.length - 1),
      elapsed: Date.now() - this.#startedAt,
      phaseElapsed: Date.now() - this.#phaseStartedAt,
      reload: this.#reload,
      serving: this.#serving,
      pending: this.#pending,
      timings: this.#timings,
      error: this.#error && { name: this.#error.name, message: this.#error.message },
    }
  }

  get timings(): PhaseTiming[] {
    return this.#timings
  }

  onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(message?: string, reload = false): void {
    this.#hooks = []
    this.#clearModule()
    this.#narrating = false
    if (this.#observing) {
      this.#startNarrating()
    }
    this.#index = 0
    this.#status = 'loading'
    this.#error = undefined
    this.#timings = []
    this.#reload = reload
    this.#serving = false
    this.#clearPending()
    this.#startedAt = Date.now()
    this.#phaseStartedAt = this.#startedAt
    this.#baseMessage = message || DEV_PHASES[0]!.message
    this.#message = this.#baseMessage
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
    this.#stopNarrating()
    this.#advance('ready', undefined, false)
    this.#status = 'ready'
    this.#error = undefined
    // Accepting a request is not answering one, so the wait is only over once a
    // document has been rendered. Until then the message says which of the two
    // has happened: something is already waiting for a page, or nothing is.
    if (this.#clients.size > 0 || this.#pending || this.#inflight.size > 0) {
      this.#message = WARMUP_MESSAGE
    }
    this.#emit()
  }

  /**
   * Record a request the app is now rendering, returning the handle to settle
   * it with. Reported only once it has been in flight for {@link REQUEST_DWELL},
   * so a page that is already compiled passes without comment.
   */
  startRequest(label: string): number {
    const id = ++this.#nextRequest
    this.#inflight.set(id, { label, startedAt: Date.now() })
    this.#scheduleDwell()
    return id
  }

  /** Settle the request {@link startRequest} handed back. */
  finishRequest(id: number): void {
    const request = this.#inflight.get(id)
    if (!request) {
      return
    }
    this.#inflight.delete(id)
    if (this.#pending !== request) {
      return
    }
    // Whatever else is still in flight has been waiting at least as long, so it
    // takes over the line rather than leaving it blank.
    this.#pending = this.#oldest(Date.now() - REQUEST_DWELL)
    this.#scheduleDwell()
    this.#emit()
  }

  /** The oldest request in flight since before `since`, if any. */
  #oldest(since: number): PendingRender | undefined {
    let oldest: PendingRender | undefined
    for (const request of this.#inflight.values()) {
      if (request.startedAt <= since && (!oldest || request.startedAt < oldest.startedAt)) {
        oldest = request
      }
    }
    return oldest
  }

  /** Report the oldest request in flight once it has dwelt long enough. */
  #scheduleDwell(): void {
    if (this.#dwell || this.#pending) {
      return
    }
    let next: number | undefined
    for (const { startedAt } of this.#inflight.values()) {
      next = next === undefined ? startedAt : Math.min(next, startedAt)
    }
    if (next === undefined) {
      return
    }
    this.#dwell = setTimeout(() => {
      this.#dwell = undefined
      this.#pending = this.#oldest(Date.now() - REQUEST_DWELL)
      if (this.#pending) {
        this.#emit()
      }
      this.#scheduleDwell()
    }, Math.max(0, next + REQUEST_DWELL - Date.now()))
    this.#dwell.unref?.()
  }

  #clearPending(): void {
    clearTimeout(this.#dwell)
    this.#dwell = undefined
    this.#pending = undefined
    this.#inflight.clear()
  }

  /** The app has answered a request, so the wait is genuinely over. */
  setServing(): void {
    if (this.#serving || this.#status !== 'ready') {
      return
    }
    this.#serving = true
    this.#message = READY_MESSAGE
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
      this.#clearModule()
    }
    const next = message || DEV_PHASES[index]!.message
    if (!advanced && next === this.#baseMessage) {
      return
    }
    this.#baseMessage = next
    this.#message = next
    this.#narrating = false
    if (emit) {
      this.#emit()
    }
  }

  #clearModule(): void {
    this.#module = undefined
  }

  /**
   * Replace the phase label with whatever the load is actually waiting on, or
   * put the phase label back once it is waiting on nothing in particular. The
   * phase index is untouched, so the fraction clients render stays monotonic.
   */
  #narrate(): void {
    if (this.#status !== 'loading') {
      return
    }

    const now = Date.now()
    // A phase this long in has stopped being explained by its own label, so
    // whatever is running is named as soon as it is seen.
    const impatient = now - this.#phaseStartedAt >= PHASE_PATIENCE
    let text: string | undefined

    // A module name reads better than the hook it was installed from, so an
    // install in flight wins over whatever hook is nested inside it.
    if (this.#module && now - this.#module.at >= (impatient ? IMPATIENT_MODULE_DWELL : MODULE_DWELL)) {
      text = `Setting up ${shortenModuleName(this.#module.name)}`
    }
    else {
      // Innermost first: the hook that has not returned yet is the one holding
      // everything above it up.
      for (let index = this.#hooks.length - 1; index >= 0; index--) {
        const hook = this.#hooks[index]!
        // A hook that was already running when the phase began is an ancestor of
        // the current work: the phase label describes it better, and naming it
        // would replace each new phase label with the hook awaiting it.
        if (hook.at < this.#phaseStartedAt) {
          break
        }
        if (now - hook.at < (impatient ? IMPATIENT_HOOK_DWELL : HOOK_DWELL)) {
          continue
        }
        // A hook that owns a phase is already described by that phase's label,
        // which reads better than its name.
        if (!HOOK_PHASES[hook.name]) {
          text = hookLabel(hook.name)
        }
        break
      }
    }

    // No current nuxt says which module it is installing, so a phase that has
    // named nothing counts the ones that have finished instead: the number
    // moving is the only sign that the ones left are being worked through.
    if (!text && impatient && this.#index === MODULES_INDEX) {
      const installed = this.#installedModules?.() ?? 0
      if (installed) {
        text = `${this.#baseMessage} \u00B7 ${installed} installed`
      }
    }

    if (!text && !this.#narrating) {
      return
    }
    this.#narrating = !!text
    const next = text ?? this.#baseMessage
    if (next !== this.#message) {
      this.#message = next
      this.#emit()
    }
  }

  #startNarrating(): void {
    if (this.#ticker) {
      return
    }
    this.#ticker = setInterval(() => this.#narrate(), NARRATION_INTERVAL)
    this.#ticker.unref?.()
  }

  #stopNarrating(): void {
    clearInterval(this.#ticker)
    this.#ticker = undefined
    this.#hooks = []
    this.#clearModule()
  }

  /**
   * Record a hook as running. Hooks nest, but they also run concurrently, so
   * this is a stack only by convention: a hook that finishes out of order is
   * removed from wherever it sits. An entry whose hook never completes would
   * otherwise sit at the bottom of the stack for the rest of the load, so the
   * oldest is dropped once the stack stops looking like one.
   */
  #pushHook(name: string): void {
    if (this.#hooks.length >= HOOK_STACK_LIMIT) {
      this.#hooks.shift()
    }
    this.#hooks.push({ name, at: Date.now() })
  }

  #popHook(name: string): void {
    const last = this.#hooks.length - 1
    if (last >= 0 && this.#hooks[last]!.name === name) {
      this.#hooks.length = last
      return
    }
    for (let index = last; index >= 0; index--) {
      if (this.#hooks[index]!.name === name) {
        this.#hooks.splice(index, 1)
        return
      }
    }
  }

  setError(error: Error): void {
    this.#stopNarrating()
    this.#error = error
    this.#status = 'error'
    this.#message = error.message || 'Nuxt failed to start.'
    this.#emit()
  }

  /**
   * Derive phases from the hooks Nuxt calls, so the granularity follows the
   * project's own build rather than a schedule guessed by the CLI, and name
   * whatever is taking long enough that the phase alone stops explaining the
   * wait. Both the modules a project installs and the hooks its own code
   * registers are only visible from here.
   */
  attachNuxt(hooks: HookableLike, options: { installedModules?: () => number } = {}): void {
    this.#installedModules ||= options.installedModules
    if (this.#observed.has(hooks)) {
      return
    }
    const timed = !!(hooks.beforeEach && hooks.afterEach)
    // Phase tracking is a nicety: a Nuxt whose hooks cannot be observed still
    // gets a loading page, it just does not advance through the phases.
    hooks.beforeEach?.(({ name, args }) => {
      if (timed) {
        this.#pushHook(name)
      }
      const phase = HOOK_PHASES[name]
      if (phase) {
        this.setPhase(phase)
      }
      else if (name === MODULE_STARTED) {
        const module = moduleName(args?.[0])
        if (module) {
          this.#module = { name: module, at: Date.now() }
        }
      }
      // A module that finishes before it earned a mention must not be named
      // afterwards: whatever the load is waiting on by then is not this module.
      else if (name === MODULE_FINISHED && moduleName(args?.[0]) === this.#module?.name) {
        this.#clearModule()
      }
      else if (name === NITRO_HOOK) {
        this.#observe((args?.[0] as { hooks?: HookableLike } | undefined)?.hooks, NITRO_PREFIX)
      }
    })

    this.#observe(hooks, '')
  }

  /**
   * Time the hooks of one system. Entries carry the prefix they were pushed
   * with, so a name shared by two systems cannot pop the other's entry, and the
   * innermost-wins rule still holds across both: Nitro builds inside a Nuxt
   * hook that is awaiting it.
   */
  #observe(hooks: HookableLike | undefined, prefix: string): void {
    // Without `afterEach` a hook can only be seen starting, never finishing, so
    // timing one would mean naming a hook that has long since returned.
    if (!hooks?.beforeEach || !hooks.afterEach || this.#observed.has(hooks)) {
      return
    }
    this.#observed.add(hooks)
    if (prefix) {
      hooks.beforeEach(({ name }) => this.#pushHook(prefix + name))
    }
    hooks.afterEach(({ name }) => this.#popHook(prefix + name))
    this.#observing = true
    this.#startNarrating()
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
        // The page that was waiting for the first render has gone, so there is
        // nothing left to narrate towards.
        this.setServing()
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
    this.#stopNarrating()
    this.#clearPending()
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

  #send(res: ServerResponse, snapshot: ProgressSnapshot): void {
    if (res.writableEnded) {
      return
    }
    res.write(`event: nuxt:${snapshot.status}\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }
}
