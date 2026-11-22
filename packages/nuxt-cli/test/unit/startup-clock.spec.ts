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

  it('should wait for the terminal background query to give stdin back', async () => {
    vi.useRealTimers()
    const { queryBackground } = await import('../../src/dev/tui/background')
    const raw: boolean[] = []
    const stdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: (value: boolean) => raw.push(value),
      isPaused: () => false,
      resume: () => {},
      pause: () => {},
      unshift: () => {},
      on: () => {},
      off: () => {},
    }
    // A terminal that never answers, so stdin is held until the timeout.
    const answer = queryBackground({
      write: () => {},
      stdin,
      stdout: { isTTY: true },
      env: { TERM: 'xterm-256color' },
      timeout: 20,
      ci: false,
      test: false,
    })

    const seen = await clock.withUserAttention(async () => [...raw])

    expect(seen).toEqual([true, false])
    await expect(answer).resolves.toBe('unknown')
  })

  it('should only let the question run once a stdin query has been answered', async () => {
    const { holdStdin } = await import('../../src/utils/stdin')
    const { registerTerminalHost } = await import('../../src/utils/terminal-host')
    const borrowed: string[] = []
    const release = holdStdin()
    const removeHost = registerTerminalHost({
      version: 1,
      startTask: () => ({
        update: () => {},
        stop: () => {},
      }),
      withTerminal: async (work) => {
        borrowed.push('suspend')
        try {
          return await work()
        }
        finally {
          borrowed.push('restore')
        }
      },
    })
    const work = vi.fn(async () => {})

    try {
      const asked = clock.withUserAttention(work)
      await Promise.resolve()
      expect(borrowed).toEqual(['suspend'])
      expect(work).not.toHaveBeenCalled()

      release()
      await asked
      expect(borrowed).toEqual(['suspend', 'restore'])
      expect(work).toHaveBeenCalledOnce()
    }
    finally {
      release()
      removeHost()
    }
  })
})
