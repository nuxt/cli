import type { NuxtDevContext } from '../../src/dev/utils'

import { EventEmitter } from 'node:events'
import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForkPool } from '../../src/dev/pool'

let nextPid = 1000

class FakeFork extends EventEmitter {
  pid = nextPid++
  exitCode: number | null = null
  sent: any[] = []
  killed?: NodeJS.Signals | number

  send(message: unknown) {
    this.sent.push(message)
    return true
  }

  kill(signal: NodeJS.Signals | number) {
    this.killed = signal
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
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

  it('should merge per-fork listen overrides into the context message', async () => {
    await createPool().getFork(context, { listenOverrides: { port: 4000, handover: true } })

    expect(forks[0]!.sent[0]).toMatchObject({
      type: 'nuxt:internal:dev:context',
      listenOverrides: { port: 4000, handover: true },
    })
  })

  it('should forward messages other than fork readiness', async () => {
    const onMessage = vi.fn()
    await createPool().getFork(context, { onMessage })
    forks[0]!.ready()
    forks[0]!.emit('message', { type: 'nuxt:internal:dev:restart' })

    expect(onMessage).toHaveBeenCalledExactlyOnceWith({ type: 'nuxt:internal:dev:restart' })
  })
})
