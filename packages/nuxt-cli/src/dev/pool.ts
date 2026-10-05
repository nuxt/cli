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
  /** Pipe fork stdio through this process so the dev UI stays below all output. */
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
  /** Resolves once the fork holds the listener (app or error page); rejects if it dies first. */
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
      // Piped forks cannot see terminal resizes.
      process.stdout.on('resize', () => {
        for (const fork of this.forks) {
          if (fork.process.connected) {
            // The fork may have exited since the check.
            fork.process.send({ type: 'nuxt:internal:dev:resize', columns: process.stdout.columns || 80 } satisfies NuxtParentIPCMessage, () => {})
          }
        }
      })
    }

    // Last resort; signals close forks gracefully through the dev command.
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
    // File changes are invisible here once a fork serves the app.
    this.warming = true

    const fork = this.idle.find(f => f.isReady) ?? this.idle[0] ?? this.createFork()
    this.idle = this.idle.filter(f => f !== fork)
    await fork.ready

    const serving = trackServing(fork.process)
    // Not every caller awaits `serving`.
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
      // Only the serving fork opens the inspector, so idle forks do not contend for the port.
      execArgv: ['--enable-source-maps'],
      stdio: pipeOutput ? ['ignore', 'pipe', 'pipe', 'ipc'] : undefined,
      env: {
        ...withoutDotenvVars(process.env),
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
        // A fork can exit without emitting `error`.
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
        logger.error(`The dev server process (PID ${childProc.pid}) exited with code ${errorCode}.`)
        process.exit(errorCode)
      }
      this.forget(pooledFork)
    })

    return pooledFork
  }

  /** Ask a fork to run its `close` hooks and exit, signalling it if that fails or takes too long. */
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

/** Resolves when the fork is answering requests, including with an error page. */
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

function withoutDotenvVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dotenvVars = (globalThis as { __c12_dotenv_vars__?: Map<object, Set<string>> }).__c12_dotenv_vars__?.get(env)
  if (!dotenvVars?.size) {
    return env
  }
  return Object.fromEntries(Object.entries(env).filter(([key]) => !dotenvVars.has(key)))
}

/** Colour settings for a piped fork, which cannot detect colour support itself. */
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
