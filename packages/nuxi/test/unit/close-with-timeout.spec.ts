import type { DotenvOptions } from 'c12'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeWithTimeout, DEFAULT_CLOSE_TIMEOUT_MS, NuxtDevServer } from '../../src/dev/utils'

// `closeWithTimeout` is the safety-net behind `NuxtDevServer.close()` — it caps the
// `nitro.close()` wait so a plugin holding a long-lived connection (Bull `BLPOP`,
// Postgres `LISTEN`, WebSocket, …) cannot deadlock dev-restart (see nuxt/nuxt#32928).

describe('closeWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes a non-zero default timeout', () => {
    expect(DEFAULT_CLOSE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('resolves immediately when the closer resolves quickly', async () => {
    const closer = vi.fn().mockResolvedValue(undefined)
    const result = closeWithTimeout(closer, 1000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(result).resolves.toBeUndefined()
    expect(closer).toHaveBeenCalledOnce()
  })

  it('resolves after the timeout when the closer never settles', async () => {
    // Closer that never resolves — simulates Bull `BLPOP` blocking on Redis.
    const closer = vi.fn(() => new Promise<void>(() => {}))
    const result = closeWithTimeout(closer, 1000)

    // Just before timeout — still pending.
    await vi.advanceTimersByTimeAsync(999)
    // After timeout fires.
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBeUndefined()
    expect(closer).toHaveBeenCalledOnce()
  })

  it('swallows closer rejections so restart can proceed', async () => {
    const closer = vi.fn().mockRejectedValue(new Error('boom'))
    const result = closeWithTimeout(closer, 1000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(result).resolves.toBeUndefined()
  })

  it('swallows synchronous throws from closer (so restart can proceed)', async () => {
    const closer = vi.fn(() => {
      throw new Error('sync boom')
    }) as unknown as () => Promise<void>
    const result = closeWithTimeout(closer, 1000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(result).resolves.toBeUndefined()
  })

  it('does not leave the timer pending after a fast close', async () => {
    const closer = vi.fn().mockResolvedValue(undefined)
    await closeWithTimeout(closer, 60_000)
    // If the timer were still scheduled, advancing the clock would keep the loop alive.
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('NuxtDevServer.close', () => {
  it('returns immediately when no Nuxt instance has been initialised yet', async () => {
    // No `init()` call — `#currentNuxt` is unset. The early return guards against
    // crashing if the parent process tears the dev server down before Nuxt loaded.
    const devServer = new NuxtDevServer({
      cwd: process.cwd(),
      dotenv: {} as DotenvOptions,
      overrides: {},
    })
    await expect(devServer.close()).resolves.toBeUndefined()
  })
})
