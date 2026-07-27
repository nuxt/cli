import type { ChildProcess } from 'node:child_process'
import type { InspectOptions } from './inspect'
import type { DevListenOverrides } from './listen'
import type { NuxtDevContext, NuxtDevIPCMessage } from './utils'

import { fork } from 'node:child_process'
import process from 'node:process'
import { debug } from '../utils/logger'

interface ForkPoolOptions {
  rawArgs: string[]
  poolSize?: number
  listenOverrides: DevListenOverrides
  inspect?: InspectOptions
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
  /** Resolves once the fork reports it is serving requests, rejects if it dies first. */
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
  private warming = false

  constructor(options: ForkPoolOptions) {
    this.rawArgs = options.rawArgs
    this.poolSize = options.poolSize ?? 1
    this.listenOverrides = options.listenOverrides
    this.inspect = options.inspect

    // Graceful shutdown
    for (const signal of [
      'exit',
      'SIGTERM' /* Graceful shutdown */,
      'SIGINT' /* Ctrl-C */,
      'SIGQUIT' /* Ctrl-\ */,
    ] as const) {
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

    // Start warming forks up to pool size
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
      close: () => this.killFork(fork),
    }
  }

  /**
   * Resolves when the fork has bound its listener and is answering requests, so
   * the caller can keep the outgoing server up until then.
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
      // Fork failed to warm, remove from pool
      this.removeFork(fork)
    })
    this.pool.push(fork)
  }

  private createFork(): PooledFork {
    const childProc = fork(globalThis.__nuxt_cli__.devEntry!, this.rawArgs, {
      // The inspector is opened by the fork that actually serves the app (see
      // `sendContext`), never via `execArgv`, so idle pooled forks don't race
      // each other for the debug port.
      execArgv: ['--enable-source-maps'],
      env: {
        ...process.env,
        __NUXT__FORK: 'true',
      },
    })

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

    // Listen for fork-ready message
    childProc.on('message', (message: NuxtDevIPCMessage) => {
      if (message.type === 'nuxt:internal:dev:fork-ready') {
        readyResolve()
      }
    })

    // Handle errors
    childProc.on('error', (err) => {
      readyReject(err)
      this.removeFork(pooledFork)
    })

    // Handle unexpected exit
    childProc.on('close', (errorCode) => {
      // A fork can exit without ever emitting `error` (a throw while loading the
      // entry, or a kill), which would leave `ready` pending forever.
      readyReject(new Error('Dev server fork exited before it finished starting.'))
      if (pooledFork.serving && errorCode) {
        // Active fork crashed
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

  private killFork(fork: PooledFork, signal: NodeJS.Signals | number = 'SIGTERM'): Promise<void> {
    const wasAlive = fork.state !== 'dead' && !!fork.process && fork.process.exitCode === null
    fork.state = 'dead'
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
