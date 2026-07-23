import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock of utils.ts module ---
vi.mock('../../src/dev/utils', async () => {
  const { EventEmitter } = await import('node:events')

  class NuxtDevServerImpl extends EventEmitter {
    listener = { close: vi.fn().mockResolvedValue(undefined) }
    init = vi.fn().mockResolvedValue(undefined)
    closeWatchers = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
    releaseLock = vi.fn()
  }

  // eslint-disable-next-line prefer-arrow-callback
  const NuxtDevServer = vi.fn().mockImplementation(function (...args: any[]) {
    return new NuxtDevServerImpl(...args)
  })

  return { NuxtDevServer }
})

// --- Mock of utils.ts dependencies ---
vi.mock('../../src/utils/env.ts', () => ({ overrideEnv: vi.fn() }))
vi.mock('../../src/utils/profile.ts', () => ({
  startCpuProfile: vi.fn().mockResolvedValue(undefined),
  stopCpuProfile: vi.fn().mockResolvedValue(undefined),
}))

// eslint-disable-next-line import/first
import { initialize } from '../../src/dev'
// eslint-disable-next-line import/first
import { NuxtDevServer } from '../../src/dev/utils'

function baseDevContext() {
  return {
    cwd: '/fake/project',
    args: {},
  } as any
}

describe('initialize dev server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the NuxtDevServer, calls init and returns the public API', async () => {
    const result = await initialize(baseDevContext())

    expect(NuxtDevServer).toHaveBeenCalledTimes(1)

    // real instance returned by the mocked constructor
    const instance = vi.mocked(NuxtDevServer).mock.results[0]!.value as InstanceType<typeof NuxtDevServer>

    expect(instance.init).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty('close')
    expect(result).toHaveProperty('onReady')
    expect(result).toHaveProperty('onRestart')
  })

  it('triggers onReady when the devServer emits "ready"', async () => {
    const result = await initialize(baseDevContext())
    const instance = vi.mocked(NuxtDevServer).mock.results[0]!.value

    const onReadyCb = vi.fn()
    result.onReady(onReadyCb)

    instance.emit('ready', 'http://localhost:3000')

    expect(onReadyCb).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('close() calls closeWatchers, listener.close, devServer.close and releaseLock', async () => {
    const result = await initialize(baseDevContext())
    const instance = vi.mocked(NuxtDevServer).mock.results[0]!.value

    await result.close()

    expect(instance.closeWatchers).toHaveBeenCalledTimes(1)
    expect(instance.listener.close).toHaveBeenCalledTimes(1)
    expect(instance.close).toHaveBeenCalledTimes(1)
    expect(instance.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('emitting "closing" runs the full shutdown flow (onBeforeQuit, close, process.exit)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      const onBeforeQuit = vi.fn()

      await initialize(baseDevContext(), { onBeforeQuit })
      const instance = vi.mocked(NuxtDevServer).mock.results[0]!.value

      instance.emit('closing')
      // the handler is async, wait for the microtask queue to flush
      await vi.waitFor(() => {
        expect(instance.close).toHaveBeenCalled()
      })

      expect(onBeforeQuit).toHaveBeenCalledWith(instance)
      expect(exitSpy).toHaveBeenCalled()
    }
    finally {
      exitSpy.mockRestore()
    }
  })
})
