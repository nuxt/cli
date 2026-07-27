import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ForkPool } from '../../src/dev/pool'

const devEntry = fileURLToPath(new URL('../fixtures/fork-pool-entry.mjs', import.meta.url))

const pools: ForkPool[] = []

function createPool(poolSize?: number) {
  globalThis.__nuxt_cli__ = { ...globalThis.__nuxt_cli__, devEntry } as typeof globalThis.__nuxt_cli__
  const pool = new ForkPool({ rawArgs: [], poolSize, listenOverrides: {} })
  pools.push(pool)
  return pool
}

async function waitForReady(pool: ForkPool, count: number) {
  await vi.waitFor(() => {
    expect(pool.getStats().ready).toBe(count)
  }, { timeout: 20_000, interval: 25 })
}

afterEach(async () => {
  for (const pool of pools.splice(0)) {
    await (pool as unknown as { killAll: (signal: number) => void }).killAll(0)
  }
})

describe('forkPool', () => {
  it('should warm a single fork by default', { timeout: 30_000 }, async () => {
    const pool = createPool()
    pool.startWarming()
    await waitForReady(pool, 1)
    expect(pool.getStats().total).toBe(1)
  })

  it('should reap a cold fork on shutdown', { timeout: 30_000 }, async () => {
    const pool = createPool(0)
    await pool.getFork({ cwd: '/some/project', args: {} })
    expect(pool.getStats()).toMatchObject({ total: 1, active: 1 })

    const [child] = (pool as unknown as { pool: Array<{ process: ChildProcess }> }).pool.map(f => f.process)
    ;(pool as unknown as { killAll: (signal: number) => void }).killAll(0)
    await vi.waitFor(() => {
      expect(child!.killed).toBe(true)
    }, { timeout: 10_000, interval: 25 })
  })

  it('should kill every fork on shutdown', { timeout: 30_000 }, async () => {
    const pool = createPool(3)
    pool.startWarming()
    await waitForReady(pool, 3)

    const processes = (pool as unknown as { pool: Array<{ process: ChildProcess }> }).pool.map(f => f.process)
    ;(pool as unknown as { killAll: (signal: number) => void }).killAll(0)

    await vi.waitFor(() => {
      for (const child of processes) {
        expect(child.killed).toBe(true)
      }
    }, { timeout: 10_000, interval: 25 })
    expect(pool.getStats().total).toBe(0)
  })
})
