import { describe, expect, it, vi } from 'vitest'

import { perFile } from '../../src/dev/utils'

describe('perFile', () => {
  it('should collapse a burst of events for one file into a single call', async () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    const { listener } = perFile(handler, 30)

    listener('change', 'nuxt.config.ts')
    listener('rename', 'nuxt.config.ts')
    listener('change', 'nuxt.config.ts')

    await vi.advanceTimersByTimeAsync(40)

    expect(handler).toHaveBeenCalledExactlyOnceWith('nuxt.config.ts')
    vi.useRealTimers()
  })

  it('should keep separate files independent', async () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    const { listener } = perFile(handler, 30)

    listener('change', 'nuxt.config.ts')
    listener('change', '.env')

    await vi.advanceTimersByTimeAsync(40)

    expect(handler.mock.calls.map(([file]) => file).sort()).toEqual(['.env', 'nuxt.config.ts'])
    vi.useRealTimers()
  })

  it('should not call the handler after cancel', async () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    const { listener, cancel } = perFile(handler, 30)

    listener('change', '.env')
    cancel()

    await vi.advanceTimersByTimeAsync(40)

    expect(handler).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
