import type { NuxtDevContext } from '../../src/dev/utils'

import { EventEmitter } from 'node:events'
import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForkPool } from '../../src/dev/pool'
import { logger } from '../../src/utils/logger'

let nextPid = 1000

class FakeFork extends EventEmitter {
  pid = nextPid++
  exitCode: number | null = null
  connected = true
  sent: any[] = []
  killed?: NodeJS.Signals | number
  signals: Array<NodeJS.Signals | number> = []
  /** Whether a `kill` should be honoured, so a fork can be made to ignore signals. */
  exitsOnKill = true

  send(message: unknown) {
    this.sent.push(message)
    return true
  }

  kill(signal: NodeJS.Signals | number) {
    this.signals.push(signal)
    this.killed = signal
    if (!this.exitsOnKill) {
      return true
    }
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  }

  exit() {
    this.exitCode = 0
    this.connected = false
    this.emit('exit', 0, null)
  }

  ready() {
    this.emit('message', { type: 'nuxt:internal:dev:fork-ready' })
  }
}

const forks: FakeFork[] = []
const fork = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ fork }))

const context: NuxtDevContext = { cwd: '/app', args: {} as NuxtDevContext['args'] }

function createPool() {
  return new ForkPool({ rawArgs: [], listenOverrides: { port: 3000 } })
}

describe('fork pool', () => {
  beforeEach(() => {
    globalThis.__nuxt_cli__ = { ...globalThis.__nuxt_cli__, devEntry: '/app/dev.mjs' }
    forks.length = 0
    fork.mockReset()
    fork.mockImplementation(() => {
      const child = new FakeFork()
      forks.push(child)
      queueMicrotask(() => child.ready())
      return child
    })
  })

  it('should resolve `serving` once the fork reports it is ready', async () => {
    const active = await createPool().getFork(context)
    const [child] = forks

    child!.emit('message', { type: 'nuxt:internal:dev:ready', address: 'http://localhost:3000' })

    await expect(active.serving).resolves.toBeUndefined()
  })

  it('should reject `serving` when the fork dies before it is ready', async () => {
    const active = await createPool().getFork(context)
    const [child] = forks

    child!.emit('close', 1, null)

    await expect(active.serving).rejects.toThrow(/exited before it was ready/)
  })

  it('should not end the session when a fork dies before it serves the app', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const active = await createPool().getFork(context)
    const [child] = forks

    child!.emit('close', 1, null)
    await expect(active.serving).rejects.toThrow()
    expect(exit).not.toHaveBeenCalled()

    const promoted = await createPool().getFork(context)
    promoted.promote()
    forks.find(f => f.pid === promoted.pid)!.emit('close', 1, null)
    expect(exit).toHaveBeenCalledWith(1)

    exit.mockRestore()
  })

  it('should say why the session ended when the serving fork crashes', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const active = await createPool().getFork(context)
    active.promote()
    forks.find(f => f.pid === active.pid)!.emit('close', 1, null)

    expect(error).toHaveBeenCalledWith(expect.stringContaining(`PID ${active.pid}`))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'))

    error.mockRestore()
    exit.mockRestore()
  })

  it('should leave `SIGINT` and `SIGTERM` to the graceful shutdown path', () => {
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))

    createPool()

    expect(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual(before)
  })

  it('should not end the session when the serving fork is closed deliberately', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const active = await createPool().getFork(context)
    active.promote()

    const child = forks.find(f => f.pid === active.pid)!
    const closing = active.close()
    child.emit('close', 1, null)
    await closing

    expect(exit).not.toHaveBeenCalled()
    exit.mockRestore()
  })

  it('should reject when the fork exits before it starts', async () => {
    fork.mockImplementation(() => {
      const child = new FakeFork()
      forks.push(child)
      queueMicrotask(() => child.emit('close', 1, null))
      return child
    })

    await expect(createPool().getFork(context)).rejects.toThrow(/exited before it finished starting/)
  })

  it('should merge per-fork listen overrides into the context message', async () => {
    await createPool().getFork(context, { listenOverrides: { port: 4000, handover: true } })

    expect(forks[0]!.sent[0]).toMatchObject({
      type: 'nuxt:internal:dev:context',
      listenOverrides: { port: 4000, handover: true },
    })
  })

  it('should let a fork run its close hooks before it exits', async () => {
    const active = await createPool().getFork(context)
    const child = forks.find(f => f.pid === active.pid)!

    const closing = active.close()
    expect(child.sent.at(-1)).toMatchObject({ type: 'nuxt:internal:dev:shutdown' })
    expect(child.killed).toBeUndefined()

    child.exit()
    await closing
  })

  it('should terminate a fork that does not shut down in time', async () => {
    vi.useFakeTimers()
    try {
      const active = await createPool().getFork(context)
      const child = forks.find(f => f.pid === active.pid)!
      child.exitsOnKill = false

      const closing = active.close()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(child.signals).toEqual(['SIGTERM'])

      await vi.advanceTimersByTimeAsync(2000)
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])

      await vi.advanceTimersByTimeAsync(2000)
      await closing
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('should signal a fork whose IPC channel is already gone', async () => {
    const active = await createPool().getFork(context)
    const child = forks.find(f => f.pid === active.pid)!
    child.connected = false

    await active.close()

    expect(child.sent.some(m => m.type === 'nuxt:internal:dev:shutdown')).toBe(false)
    expect(child.killed).toBe('SIGTERM')
  })

  it('should forward messages other than fork readiness', async () => {
    const onMessage = vi.fn()
    await createPool().getFork(context, { onMessage })
    forks[0]!.ready()
    forks[0]!.emit('message', { type: 'nuxt:internal:dev:restart' })

    expect(onMessage).toHaveBeenCalledExactlyOnceWith({ type: 'nuxt:internal:dev:restart' })
  })
})
