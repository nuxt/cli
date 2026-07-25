import type { ChildProcess } from 'node:child_process'
import type { InspectOptions } from './inspect'
import type { DevListenOverrides } from './listen'
import type { NuxtDevContext, NuxtDevIPCMessage } from './utils'

import { fork } from 'node:child_process'
import process from 'node:process'
import { isDeno } from 'std-env'
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
    this.poolSize = options.poolSize ?? 2
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

  async getFork(context: NuxtDevContext, onMessage?: (message: NuxtDevIPCMessage) => void): Promise<() => Promise<void>> {
    // Try to get a ready fork from the pool
    const readyFork = this.pool.find(f => f.state === 'ready')

    if (readyFork) {
      readyFork.state = 'active'
      if (onMessage) {
        this.attachMessageHandler(readyFork.process, onMessage)
      }
      await this.sendContext(readyFork.process, context)

      // Start warming a replacement fork
      if (this.warming) {
        this.warmFork()
      }

      return () => this.killFork(readyFork)
    }

    // No ready fork available, try a warming fork
    const warmingFork = this.pool.find(f => f.state === 'warming')
    if (warmingFork) {
      await warmingFork.ready
      warmingFork.state = 'active'
      if (onMessage) {
        this.attachMessageHandler(warmingFork.process, onMessage)
      }
      await this.sendContext(warmingFork.process, context)

      // Start warming a replacement fork
      if (this.warming) {
        this.warmFork()
      }

      return () => this.killFork(warmingFork)
    }

    // No forks in pool, create a cold fork
    debug('No pre-warmed forks available, starting cold fork')
    const coldFork = this.createFork()
    await coldFork.ready
    coldFork.state = 'active'
    if (onMessage) {
      this.attachMessageHandler(coldFork.process, onMessage)
    }
    await this.sendContext(coldFork.process, context)

    return () => this.killFork(coldFork)
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
      if (pooledFork.state === 'active' && errorCode) {
        // Active fork crashed
        process.exit(errorCode)
      }
      this.removeFork(pooledFork)
    })

    return pooledFork
  }

  private async sendContext(childProc: ChildProcess, context: NuxtDevContext): Promise<void> {
    childProc.send({
      type: 'nuxt:internal:dev:context',
      listenOverrides: this.listenOverrides,
      inspect: this.inspect,
      context,
    })
  }

  private killFork(fork: PooledFork, signal: NodeJS.Signals | number = 'SIGTERM'): Promise<void> {
    const wasAlive = fork.state !== 'dead' && !!fork.process && fork.process.exitCode === null
    fork.state = 'dead'
    if (fork.process) {
      fork.process.kill(signal === 0 && isDeno ? 'SIGTERM' : signal)
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
    for (const fork of this.pool) {
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
