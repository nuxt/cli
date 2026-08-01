import { describe, expect, it, vi } from 'vitest'

import { summariseActiveResources, warnOnHang } from '../../src/utils/hang'

describe('summariseActiveResources', () => {
  it('should ignore the handles every process has', () => {
    expect(summariseActiveResources(['TTYWrap', 'PipeWrap', 'SignalWrap', 'FileHandle'])).toBeUndefined()
  })

  it('should group resources by what they mean to a user', () => {
    expect(summariseActiveResources(['Timeout', 'Timeout', 'Immediate', 'FSEventWrap', 'TCPWrap'])).toBe('3 timers, 1 file watcher, 1 open connection')
  })

  it('should fall back to the internal name for unknown resources', () => {
    expect(summariseActiveResources(['SomeAddonHandle'])).toBe('1 SomeAddonHandle')
  })
})

describe('warnOnHang', () => {
  it('should report what is keeping the process alive', async () => {
    vi.useFakeTimers()
    try {
      const warn = vi.fn()
      const interval = setInterval(() => {}, 1000)
      warnOnHang({ timeout: 10, action: '`nuxt build`', warn })

      await vi.advanceTimersByTimeAsync(10)

      clearInterval(interval)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]![0]).toContain('The `nuxt build` is complete but the process is still running')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('should not warn once disarmed', async () => {
    vi.useFakeTimers()
    try {
      const warn = vi.fn()
      warnOnHang({ timeout: 10, warn })()

      await vi.advanceTimersByTimeAsync(100)

      expect(warn).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
