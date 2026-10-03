import type { ChildProcess } from 'node:child_process'
import type { InspectOptions } from './inspect'
import type { DevListenOverrides } from './listen'
import type { NuxtDevContext, NuxtDevIPCMessage, NuxtParentIPCMessage } from './utils'

import { fork } from 'node:child_process'
import process from 'node:process'
import { debug, logger } from '../utils/logger'
import { writeDirectTo } from '../utils/stdout'
import { DEV_SHUTDOWN_TIMEOUT_MS, FORCE_KILL_TIMEOUT_MS } from './shutdown'

interface ForkPoolOptions {
  rawArgs: string[]
  poolSize?: number
  listenOverrides: DevListenOverrides
  inspect?: InspectOptions
  /**
   * Pipe fork stdio through this process instead of inheriting the terminal,
   * so the interactive dev UI can keep its footer below all output.
   */
  pipeOutput?: boolean
}

interface PooledFork {
  process: ChildProcess
  ready: Promise<void>
  isReady: boolean
  closing: boolean
  /** Whether this fork is the one serving the app, so its crash ends the session. */
  serving: boolean
}

export interface ActiveFork {
  pid?: number
  /**
   * Resolves once the fork holds the listener, whether the app loaded or the
   * error page is being served, and rejects if it dies before that.
   */
  serving: Promise<void>
  /** Promote the fork so that a later crash takes the dev session down. */
  promote: () => void
  close: () => Promise<void>
}

interface GetForkOptions {
  onMessage?: (message: NuxtDevIPCMessage) => void
  /** Listen options for this fork only, merged over the pool-wide overrides. */
  listenOverrides?: Partial<DevListenOverrides>
}

export class ForkPool {
  private forks = new Set<PooledFork>()
  /** Forks that are starting or ready and not yet handed out. */
  private idle: PooledFork[] = []
  private poolSize: number
  private warming = false
  private options: ForkPoolOptions

  constructor(options: ForkPoolOptions) {
    this.options = options
    this.poolSize = options.poolSize ?? 1

    if (options.pipeOutput) {
      // Piped forks read the terminal width from their environment snapshot,
      // so resizes have to be forwarded for the fancy reporter's alignment.
      process.stdout.on('resize', () => {
        for (const fork of this.forks) {
          if (fork.process.connected) {
            // A fork can die between the check and the send, and this runs from
            // a `resize` event where a throw would end the session.
            fork.process.send({ type: 'nuxt:internal:dev:resize', columns: process.stdout.columns || 80 } satisfies NuxtParentIPCMessage, () => {})
          }
        }
      })
    }

    // Last resort for forks that outlive this process. `SIGINT`/`SIGTERM` close
    // forks gracefully through the dev command instead.
    process.once('exit', () => this.killAll('SIGTERM'))
    process.once('SIGQUIT', () => this.killAll('SIGQUIT'))
  }

  startWarming(): void {
    if (!this.warming) {
      this.warming = true
      this.fill()
    }
  }

  async getFork(context: NuxtDevContext, options: GetForkOptions = {}): Promise<ActiveFork> {
    // Once the app is served by a fork, file changes are no longer visible to
    // this process, so a restart is the only signal left that more may follow.
    this.warming = true

    const fork = this.idle.find(f => f.isReady) ?? this.idle[0] ?? this.createFork()
    this.idle = this.idle.filter(f => f !== fork)
    await fork.ready

    const serving = trackServing(fork.process)
    // Callers that never await `serving` must not turn its rejection into an
    // unhandled rejection.
    serving.catch(() => {})
    const onMessage = options.onMessage
    if (onMessage) {
      fork.process.on('message', (message: NuxtDevIPCMessage) => {
        if (message.type !== 'nuxt:internal:dev:fork-ready') {
          onMessage(message)
        }
      })
    }
    fork.process.send({
      type: 'nuxt:internal:dev:context',
      listenOverrides: { ...this.options.listenOverrides, ...options.listenOverrides },
      inspect: this.options.inspect,
      context,
    } satisfies NuxtParentIPCMessage)

    this.fill()

    return {
      pid: fork.process.pid,
      serving,
      promote: () => {
        fork.serving = true
      },
      close: () => this.closeFork(fork),
    }
  }

  private fill(): void {
    while (this.idle.length < this.poolSize) {
      this.idle.push(this.createFork())
    }
  }

  /** `ready` rejects if the fork exits before it reports readiness. */
  private createFork(): PooledFork {
    const pipeOutput = this.options.pipeOutput
    const childProc = fork(globalThis.__nuxt_cli__.devEntry!, this.options.rawArgs, {
      // The inspector is opened by the fork that actually serves the app, never
      // via `execArgv`, so idle forks don't race each other for the debug port.
      execArgv: ['--enable-source-maps'],
      stdio: pipeOutput ? ['ignore', 'pipe', 'pipe', 'ipc'] : undefined,
      env: {
        ...process.env,
        __NUXT__FORK: 'true',
        ...pipeOutput
          ? {
              __NUXT_DEV_PIPED_TTY__: '1',
              __NUXT_DEV_COLUMNS__: String(process.stdout.columns || 80),
              ...forcedColorEnv(),
            }
          : {},
      },
    })

    if (pipeOutput) {
      childProc.stdout?.on('data', (chunk: Uint8Array) => writeDirectTo(process.stdout, chunk))
      childProc.stderr?.on('data', (chunk: Uint8Array) => writeDirectTo(process.stderr, chunk))
    }

    const pooledFork: PooledFork = {
      process: childProc,
      ready: new Promise<void>((resolve, reject) => {
        childProc.on('message', (message: NuxtDevIPCMessage) => {
          if (message.type === 'nuxt:internal:dev:fork-ready') {
            resolve()
          }
        })
        childProc.on('error', reject)
        // A fork can exit without ever emitting `error` (a throw while loading the
        // entry, or a kill), which would leave `ready` pending forever.
        childProc.on('close', () => reject(new Error('Dev server fork exited before it finished starting.')))
      }),
      isReady: false,
      closing: false,
      serving: false,
    }
    pooledFork.ready.then(() => {
      pooledFork.isReady = true
    }, () => {})
    this.forks.add(pooledFork)

    childProc.on('error', () => this.forget(pooledFork))
    childProc.on('close', (errorCode) => {
      if (pooledFork.serving && errorCode) {
        // Ending the session on the crash of the process that holds the listener is
        // silent otherwise, leaving no clue as to what stopped the dev server.
        logger.error(`The dev server process (PID ${childProc.pid}) exited with code ${errorCode}.`)
        process.exit(errorCode)
      }
      this.forget(pooledFork)
    })

    return pooledFork
  }

  /**
   * Ask a fork to shut down and wait for its `close` hooks to run, so nitro plugins
   * and anything else the app opened get to tear down before the process goes away.
   * A fork that takes too long, or can no longer be asked, is signalled instead.
   */
  private async closeFork(fork: PooledFork): Promise<void> {
    const alive = !fork.closing && fork.process.exitCode === null
    fork.closing = true
    // A fork we are shutting down on purpose must not end the session.
    fork.serving = false
    this.forget(fork)
    if (!alive) {
      return
    }

    const exited = waitForExit(fork.process)
    if (fork.process.connected) {
      fork.process.send({ type: 'nuxt:internal:dev:shutdown' } satisfies NuxtParentIPCMessage, (error) => {
        if (error) {
          fork.process.kill('SIGTERM')
        }
      })
      if (await settlesWithin(exited, DEV_SHUTDOWN_TIMEOUT_MS)) {
        return
      }
      debug(`Dev server fork ${fork.process.pid} did not shut down in time, terminating it`)
    }

    fork.process.kill('SIGTERM')
    if (await settlesWithin(exited, FORCE_KILL_TIMEOUT_MS)) {
      return
    }
    fork.process.kill('SIGKILL')
    await settlesWithin(exited, FORCE_KILL_TIMEOUT_MS)
  }

  private forget(fork: PooledFork): void {
    this.forks.delete(fork)
    this.idle = this.idle.filter(f => f !== fork)
  }

  private killAll(signal: NodeJS.Signals): void {
    for (const fork of this.forks) {
      fork.serving = false
      fork.process.kill(signal)
    }
    this.forks.clear()
    this.idle = []
  }
}

/**
 * Resolves when the fork has bound its listener and is answering requests. A load
 * failure counts: the fork is serving an error page and owns the port either way.
 */
function trackServing(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    function settle(finish: () => void) {
      child.off('message', onMessage)
      child.off('close', onExit)
      child.off('error', onExit)
      finish()
    }
    function onMessage(message: NuxtDevIPCMessage) {
      if (message.type === 'nuxt:internal:dev:ready' || message.type === 'nuxt:internal:dev:loading:error') {
        settle(resolve)
      }
    }
    function onExit() {
      settle(() => reject(new Error('Dev server fork exited before it was ready.')))
    }
    child.on('message', onMessage)
    child.once('close', onExit)
    child.once('error', onExit)
  })
}

/**
 * Color settings for a fork whose stdio is piped back to this terminal.
 * `isTTY` alone is not enough: `styleText` and most color libraries consult
 * the color depth or `FORCE_COLOR`, which a pipe does not carry.
 */
function forcedColorEnv(): Record<string, string> {
  if (process.env.NO_COLOR || process.env.FORCE_COLOR) {
    return {}
  }
  const depth = process.stdout.getColorDepth?.() ?? 1
  if (depth <= 1) {
    return {}
  }
  const level = depth >= 24 ? '3' : depth >= 8 ? '2' : '1'
  return { FORCE_COLOR: level, __NUXT_DEV_COLOR_DEPTH__: String(depth) }
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('close', () => resolve())
  })
}

/** Resolves `true` if the promise settles before the timeout, `false` otherwise. */
function settlesWithin(promise: Promise<void>, timeout: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(resolve, timeout, false)
    timer.unref?.()
    void promise.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}
