import { EventEmitter } from 'node:events'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { closeListener, closeNuxt, closeWatchers, devServers, releaseLock, startCpuProfile, stopCpuProfile } = vi.hoisted(() => ({
  closeListener: vi.fn(() => Promise.resolve()),
  closeNuxt: vi.fn(() => Promise.resolve()),
  closeWatchers: vi.fn(),
  devServers: [] as any[],
  releaseLock: vi.fn(),
  startCpuProfile: vi.fn(() => Promise.resolve()),
  stopCpuProfile: vi.fn(),
}))

vi.mock('../../../src/utils/profile.ts', () => ({ startCpuProfile, stopCpuProfile }))
vi.mock('../../../src/utils/env.ts', () => ({ overrideEnv: vi.fn() }))

vi.mock('../../../src/dev/utils', () => ({
  NuxtDevServer: class extends EventEmitter {
    listener = { url: 'http://127.0.0.1:3000', close: closeListener }
    closeWatchers = closeWatchers
    close = closeNuxt
    releaseLock = releaseLock
    load = vi.fn(() => Promise.resolve())
    progress = { onUpdate: vi.fn(() => () => {}), close: vi.fn() }

    constructor(readonly options: Record<string, any>) {
      super()
      devServers.push(this)
    }

    init = vi.fn(async () => {
      this.emit('ready', 'http://127.0.0.1:3000')
    })
  },
}))

const { initialize } = await import('../../../src/dev/index')

function context(args: Record<string, unknown> = {}) {
  return { cwd: process.cwd(), args: { ...args } } as never
}

beforeEach(() => {
  devServers.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('initialize', () => {
  it('should report the address to a callback registered after ready', async () => {
    const { onReady } = await initialize(context())
    const seen: string[] = []

    onReady(address => seen.push(address))

    expect(seen).toEqual(['http://127.0.0.1:3000'])
  })

  it('should close the watchers, the listener and nuxt before releasing the lock', async () => {
    const order: string[] = []
    closeWatchers.mockImplementation(() => order.push('watchers'))
    closeListener.mockImplementation(async () => void order.push('listener'))
    closeNuxt.mockImplementation(async () => void order.push('nuxt'))
    releaseLock.mockImplementation(() => order.push('lock'))

    const { close } = await initialize(context())
    await close()

    expect(order[0]).toBe('watchers')
    expect(order.at(-1)).toBe('lock')
    expect(order).toContain('listener')
    expect(order).toContain('nuxt')
  })

  it('should close only once however often it is asked', async () => {
    const { close } = await initialize(context())

    await Promise.all([close(), close()])
    await close()

    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(closeListener).toHaveBeenCalledTimes(1)
  })

  it('should release the lock even when closing fails', async () => {
    closeNuxt.mockRejectedValue(new Error('nitro would not close'))

    const { close } = await initialize(context())

    await expect(close()).rejects.toThrow('nitro would not close')
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('should reload in place when asked', async () => {
    const { reload } = await initialize(context())

    await reload({ type: 'shortcut' })

    expect(devServers[0].load).toHaveBeenCalledWith(true, { type: 'shortcut' })
  })

  it('should pass `extends` through to the dev server overrides', async () => {
    await initialize(context({ extends: ['../layer'] }))

    expect(devServers[0].options.overrides).toMatchObject({ extends: ['../layer'] })
  })

  it('should not profile unless it was asked to', async () => {
    await initialize(context())

    expect(startCpuProfile).not.toHaveBeenCalled()
    expect(devServers[0].options.overrides.debug).toBeUndefined()
  })

  it('should profile quietly for a bare `--profile`', async () => {
    await initialize(context({ profile: '' }))

    expect(startCpuProfile).toHaveBeenCalledTimes(1)
    expect(devServers[0].options.overrides).toMatchObject({ debug: { perf: 'quiet' } })
  })

  it('should profile verbosely for `--profile=verbose`', async () => {
    await initialize(context({ profile: 'verbose' }))

    expect(devServers[0].options.overrides).toMatchObject({ debug: { perf: true } })
  })

  it('should hand the file change and restart hooks to the caller', async () => {
    const { onFileChange, onRestart } = await initialize(context())
    const changed = vi.fn()
    const restarted = vi.fn()

    onFileChange(changed)
    onRestart(restarted)
    devServers[0].emit('change')
    devServers[0].emit('restart', { type: 'hook' })

    expect(changed).toHaveBeenCalledTimes(1)
    expect(restarted).toHaveBeenCalledWith({ type: 'hook' })
  })
})
