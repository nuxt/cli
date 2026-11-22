import { beforeEach, describe, expect, it, vi } from 'vitest'

type Stdin = typeof import('../../src/utils/stdin')

describe('stdin hold', () => {
  let holdStdin: Stdin['holdStdin']
  let whenStdinReleased: Stdin['whenStdinReleased']

  beforeEach(async () => {
    vi.resetModules()
    ;({ holdStdin, whenStdinReleased } = await import('../../src/utils/stdin'))
  })

  it('should only report a hold while something has stdin', () => {
    expect(whenStdinReleased()).toBeUndefined()

    const release = holdStdin()
    expect(whenStdinReleased()).toBeDefined()

    release()
    expect(whenStdinReleased()).toBeUndefined()
  })

  it('should not let a repeated or stale release clear a newer hold', async () => {
    const releaseFirst = holdStdin()
    const first = whenStdinReleased()
    const releaseSecond = holdStdin()
    const second = whenStdinReleased()

    releaseFirst()
    releaseFirst()
    await first
    expect(whenStdinReleased()).toBe(second)

    releaseSecond()
    releaseSecond()
    await second
    expect(whenStdinReleased()).toBeUndefined()
  })
})
