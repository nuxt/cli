import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Clock = typeof import('../../src/utils/startup-clock')

describe('startup clock', () => {
  let clock: Clock

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    clock = await import('../../src/utils/startup-clock')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should measure elapsed time when never paused', () => {
    const start = Date.now()
    vi.advanceTimersByTime(500)
    expect(clock.startupElapsedMs(start)).toBe(500)
  })

  it('should exclude paused stretches', async () => {
    const start = Date.now()
    vi.advanceTimersByTime(200)
    await clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(5000)
    })
    vi.advanceTimersByTime(300)
    expect(clock.startupElapsedMs(start)).toBe(500)
  })

  it('should not count time while a pause is still open', async () => {
    const start = Date.now()
    vi.advanceTimersByTime(100)
    await clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(9000)
      expect(clock.startupElapsedMs(start)).toBe(100)
    })
    vi.advanceTimersByTime(50)
    expect(clock.startupElapsedMs(start)).toBe(150)
  })

  it('should support nested pauses', async () => {
    const start = Date.now()
    await clock.withStartupClockPaused(() => clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(1000)
    }))
    vi.advanceTimersByTime(250)
    expect(clock.startupElapsedMs(start)).toBe(250)
  })

  it('should not charge a baseline taken after the pause', async () => {
    await clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(5000)
    })
    const start = Date.now()
    vi.advanceTimersByTime(300)
    expect(clock.startupElapsedMs(start)).toBe(300)
  })

  it('should subtract only the part of a pause that follows the baseline', async () => {
    let start = 0
    await clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(1000)
      start = Date.now()
      vi.advanceTimersByTime(1000)
    })
    vi.advanceTimersByTime(200)
    expect(clock.startupElapsedMs(start)).toBe(200)
  })

  it('should resume after the paused work throws', async () => {
    const start = Date.now()
    await expect(clock.withStartupClockPaused(async () => {
      vi.advanceTimersByTime(1000)
      throw new Error('declined')
    })).rejects.toThrow('declined')
    vi.advanceTimersByTime(400)
    expect(clock.startupElapsedMs(start)).toBe(400)
  })
})
