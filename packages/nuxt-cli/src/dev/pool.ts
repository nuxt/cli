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
  state: 'warming' | 'ready' | 'active' | 'dead'
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
  private pool: PooledFork[] = []
  private poolSize: number
  private rawArgs: string[]
  private listenOverrides: DevListenOverrides
  private inspect?: InspectOptions
  private pipeOutput: boolean
  private warming = false

  constructor(options: ForkPoolOptions) {
    this.rawArgs = options.rawArgs
    this.poolSize = options.poolSize ?? 1
    this.listenOverrides = options.listenOverrides
    this.inspect = options.inspect
    this.pipeOutput = options.pipeOutput ?? false

    if (this.pipeOutput) {
      // Piped forks read the terminal width from their environment snapshot,
      // so resizes have to be forwarded for the fancy reporter's alignment.
      process.stdout.on('resize', () => {
        for (const fork of this.pool) {
          if (fork.state !== 'dead' && fork.process.connected) {
            // A fork can die between the check and the send, and this runs from
            // a `resize` event where a throw would end the session.
            fork.process.send({ type: 'nuxt:internal:dev:resize', columns: process.stdout.columns || 80 } satisfies NuxtParentIPCMessage, () => {})
          }
        }
      })
    }

    // last-resort for forks that outlive this process. nuxt closes forks gracefully
    // on `SIGINT`/`SIGTERM`, so we skip them.
    for (const signal of ['exit', 'SIGQUIT'] as const) {
      process.once(signal, () => {
        this.killAll(signal === 'exit' ? 0 : signal)
      })
    }
  }

  startWarming(): void {
    if (this.warming) {
      return
    }
    this.warming = true

    for (let i = 0; i < this.poolSize; i++) {
      this.warmFork()
    }
  }

  async getFork(context: NuxtDevContext, options: GetForkOptions = {}): Promise<ActiveFork> {
    // Once the app is served by a fork, file changes are no longer visible to
    // this process, so a restart is the only signal left that more may follow.
    this.warming = true

    const pooledFork = this.pool.find(f => f.state === 'ready')
      ?? this.pool.find(f => f.state === 'warming')

    if (!pooledFork) {
      debug('No pre-warmed forks available, starting cold fork')
    }

    const fork = pooledFork ?? this.createFork()
    if (!pooledFork) {
      this.pool.push(fork)
    }
    await fork.ready
    fork.state = 'active'

    const serving = this.trackServing(fork)
    // Callers that never await `serving` (a caller that only wants the fork, or
    // one that has already given up on it) must not turn its rejection into an
    // unhandled rejection.
    serving.catch(() => {})
    if (options.onMessage) {
      this.attachMessageHandler(fork.process, options.onMessage)
    }
    await this.sendContext(fork.process, context, options.listenOverrides)

    this.warmFork()

    return {
      pid: fork.process.pid,
      serving,
      promote: () => {
        fork.serving = true
      },
      close: () => this.closeFork(fork),
    }
  }

  /**
   * Resolves when the fork has bound its listener and is answering requests, so
   * the caller can keep the outgoing server up until then. A load failure counts:
   * the fork is serving an error page and owns the port either way.
   */
  private trackServing(fork: PooledFork): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      function settle(finish: () => void) {
        fork.process.off('message', onMessage)
        fork.process.off('close', onExit)
        fork.process.off('error', onExit)
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
      fork.process.on('message', onMessage)
      fork.process.once('close', onExit)
      fork.process.once('error', onExit)
    })
  }

  private attachMessageHandler(childProc: ChildProcess, onMessage: (message: NuxtDevIPCMessage) => void): void {
    childProc.on('message', (message: NuxtDevIPCMessage) => {
      // Don't forward fork-ready messages as those are internal
      if (message.type !== 'nuxt:internal:dev:fork-ready') {
        onMessage(message)
      }
    })
  }

  private warmFork(): void {
    const idle = this.pool.filter(f => f.state === 'warming' || f.state === 'ready').length
    if (idle >= this.poolSize) {
      return
    }

    const fork = this.createFork()
    fork.ready.then(() => {
      if (fork.state === 'warming') {
        fork.state = 'ready'
      }
    }).catch(() => {
      this.removeFork(fork)
    })
    this.pool.push(fork)
  }

  /**
   * `ready` always settles, rejecting if the fork exits at any point, so every
   * caller has to keep a rejection handler attached to it.
   */
  private createFork(): PooledFork {
    const childProc = fork(globalThis.__nuxt_cli__.devEntry!, this.rawArgs, {
      // The inspector is opened by the fork that actually serves the app (see
      // `sendContext`), never via `execArgv`, so idle pooled forks don't race
      // each other for the debug port.
      execArgv: ['--enable-source-maps'],
      stdio: this.pipeOutput ? ['ignore', 'pipe', 'pipe', 'ipc'] : undefined,
      env: {
        ...process.env,
        __NUXT__FORK: 'true',
        ...this.pipeOutput
          ? {
              __NUXT_DEV_PIPED_TTY__: '1',
              __NUXT_DEV_COLUMNS__: String(process.stdout.columns || 80),
              ...forcedColorEnv(),
            }
          : {},
      },
    })

    if (this.pipeOutput) {
      childProc.stdout?.on('data', (chunk: Uint8Array) => writeDirectTo(process.stdout, chunk))
      childProc.stderr?.on('data', (chunk: Uint8Array) => writeDirectTo(process.stderr, chunk))
    }

    let readyResolve: () => void
    let readyReject: (err: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })

    const pooledFork: PooledFork = {
      process: childProc,
      ready,
      state: 'warming',
      serving: false,
    }

    childProc.on('message', (message: NuxtDevIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:fork-ready') {
        readyResolve()
      }
    })

    childProc.on('error', (err) => {
      readyReject(err)
      this.removeFork(pooledFork)
    })

    childProc.on('close', (errorCode) => {
      // A fork can exit without ever emitting `error` (a throw while loading the
      // entry, or a kill), which would leave `ready` pending forever.
      readyReject(new Error('Dev server fork exited before it finished starting.'))
      if (pooledFork.serving && errorCode) {
        // Ending the session on the crash of the process that holds the listener is
        // silent otherwise, leaving no clue as to what stopped the dev server.
        logger.error(`The dev server process (PID ${childProc.pid}) exited with code ${errorCode}.`)
        process.exit(errorCode)
      }
      this.removeFork(pooledFork)
    })

    return pooledFork
  }

  private async sendContext(childProc: ChildProcess, context: NuxtDevContext, listenOverrides?: Partial<DevListenOverrides>): Promise<void> {
    childProc.send({
      type: 'nuxt:internal:dev:context',
      listenOverrides: { ...this.listenOverrides, ...listenOverrides },
      inspect: this.inspect,
      context,
    })
  }

  /**
   * Ask a fork to shut down and wait for its `close` hooks to run, so nitro plugins
   * and anything else the app opened get to tear down before the process goes away.
   * A fork that takes too long is signalled instead.
   */
  private async closeFork(fork: PooledFork): Promise<void> {
    if (fork.state === 'dead' || fork.process.exitCode !== null || !fork.process.connected) {
      return this.killFork(fork)
    }

    fork.state = 'dead'
    // A fork we are shutting down on purpose must not end the session.
    fork.serving = false
    this.removeFork(fork)

    const exited = waitForExit(fork.process)
    fork.process.send({ type: 'nuxt:internal:dev:shutdown' } satisfies NuxtParentIPCMessage, (error) => {
      if (error) {
        fork.process.kill('SIGTERM')
      }
    })

    if (await settlesWithin(exited, DEV_SHUTDOWN_TIMEOUT_MS)) {
      return
    }

    debug(`Dev server fork ${fork.process.pid} did not shut down in time, terminating it`)
    fork.process.kill('SIGTERM')
    if (await settlesWithin(exited, FORCE_KILL_TIMEOUT_MS)) {
      return
    }

    fork.process.kill('SIGKILL')
    await settlesWithin(exited, FORCE_KILL_TIMEOUT_MS)
  }

  private killFork(fork: PooledFork, signal: NodeJS.Signals | number = 'SIGTERM'): Promise<void> {
    const wasAlive = fork.state !== 'dead' && !!fork.process && fork.process.exitCode === null
    fork.state = 'dead'
    // A fork we are shutting down on purpose must not end the session, however
    // it exits on the way out.
    fork.serving = false
    if (fork.process) {
      // signal 0 only probes for liveness, so map the `exit` case onto a real signal
      fork.process.kill(signal === 0 ? 'SIGTERM' : signal)
    }
    this.removeFork(fork)

    if (!wasAlive) {
      return Promise.resolve()
    }

    // Resolve once the OS has reaped the process; the next fork may need to
    // rebind ports (such as the inspector port) that it still holds.
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000)
      timeout.unref?.()
      fork.process.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  private removeFork(fork: PooledFork): void {
    const index = this.pool.indexOf(fork)
    if (index > -1) {
      this.pool.splice(index, 1)
    }
  }

  private killAll(signal: NodeJS.Signals | number): void {
    // `killFork` mutates the pool, so iterate over a snapshot
    for (const fork of [...this.pool]) {
      this.killFork(fork, signal)
    }
  }

  getStats() {
    return {
      total: this.pool.length,
      warming: this.pool.filter(f => f.state === 'warming').length,
      ready: this.pool.filter(f => f.state === 'ready').length,
      active: this.pool.filter(f => f.state === 'active').length,
    }
  }
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
