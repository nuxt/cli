import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scheduleUpdateNudgeImpl = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../../../src/utils/update', () => ({
  scheduleUpdateNudge: scheduleUpdateNudgeImpl,
}))

const { scheduleUpdateNudge } = await import('../../../src/utils/update-lazy')

describe('scheduleUpdateNudge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    scheduleUpdateNudgeImpl.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not touch the update module until the startup grace period elapses', async () => {
    const pending = scheduleUpdateNudge('/project', 'dev')

    await vi.advanceTimersByTimeAsync(0)
    expect(scheduleUpdateNudgeImpl).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    await pending
    expect(scheduleUpdateNudgeImpl).toHaveBeenCalledWith('/project', 'dev')
  })

  it('should propagate failures from the deferred check', async () => {
    scheduleUpdateNudgeImpl.mockRejectedValueOnce(new Error('boom'))

    const pending = scheduleUpdateNudge('/project', 'dev')
    const assertion = expect(pending).rejects.toThrow('boom')

    await vi.advanceTimersByTimeAsync(3000)
    await assertion
  })
})
