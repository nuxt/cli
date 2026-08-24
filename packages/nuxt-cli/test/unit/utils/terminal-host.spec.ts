import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerTerminalHost, useTerminalHost } from '../../../src/utils/terminal-host'

function fakeHost() {
  return {
    version: 1 as const,
    withTerminal: <T>(work: () => Promise<T>) => work(),
    startTask: () => ({ update: vi.fn(), stop: vi.fn() }),
  }
}

describe('terminal host registry', () => {
  afterEach(() => {
    // A leaked host would leak into every later test in the process.
    registerTerminalHost(fakeHost())()
  })

  it('should publish a host for the whole process until released', () => {
    const host = fakeHost()
    const release = registerTerminalHost(host)

    expect(useTerminalHost()).toBe(host)
    release()
    expect(useTerminalHost()).toBeUndefined()
  })

  it('should not let a stale release take down a newer host', () => {
    const first = fakeHost()
    const releaseFirst = registerTerminalHost(first)
    const second = fakeHost()
    const releaseSecond = registerTerminalHost(second)

    releaseFirst()
    expect(useTerminalHost()).toBe(second)
    releaseSecond()
  })

  it('should ignore a host speaking a different revision of the contract', () => {
    const release = registerTerminalHost({ ...fakeHost(), version: 2 as never })

    expect(useTerminalHost()).toBeUndefined()
    release()
  })
})
