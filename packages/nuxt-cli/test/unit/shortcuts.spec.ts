import type { Listener } from '../../src/dev/listen'
import type { ShortcutContext } from '../../src/dev/shortcuts'

import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { setupShortcuts } from '../../src/dev/shortcuts'

const { copyURL, openBrowser, printQRCode } = vi.hoisted(() => ({
  copyURL: vi.fn(),
  openBrowser: vi.fn(),
  printQRCode: vi.fn(),
}))

vi.mock('../../src/dev/listen', () => ({ copyURL, openBrowser, printQRCode }))

const environment = vi.hoisted(() => ({ isCI: false, isTest: false }))

vi.mock('std-env', () => ({
  get isCI() {
    return environment.isCI
  },
  get isTest() {
    return environment.isTest
  },
}))

describe('setupShortcuts', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    for (const restore of restores.splice(0)) {
      restore()
    }
    Object.assign(environment, { isCI: false, isTest: false })
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  function setup(context: Partial<ShortcutContext> = {}, { isTTY = true, isRaw = false } = {}) {
    const stdin = new PassThrough() as unknown as typeof process.stdin
    Object.assign(stdin, { isTTY, isRaw, setRawMode: vi.fn((raw: boolean) => Object.assign(stdin, { isRaw: raw })) })

    const original = process.stdin
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    restores.push(() => Object.defineProperty(process, 'stdin', { value: original, configurable: true }))

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const listener = {
      url: 'http://localhost:3000/',
      getURLs: () => [{ url: 'http://localhost:3000/', type: 'local' as const }],
      showURLs: vi.fn(),
    } as unknown as Listener

    const resolved: ShortcutContext = {
      listener,
      close: vi.fn(async () => {}),
      onReady: callback => callback('http://localhost:3000/'),
      ...context,
    }

    setupShortcuts(resolved)

    return {
      context: resolved,
      listener,
      stdin,
      press: async (input: string) => {
        stdin.write(`${input}\n`)
        await new Promise(resolve => setImmediate(resolve))
      },
    }
  }

  it('should not read stdin when it is not a TTY', () => {
    const { stdin } = setup({}, { isTTY: false })

    expect(stdin.listenerCount('data')).toBe(0)
  })

  it('should not read stdin in CI or under test', () => {
    environment.isCI = true
    expect(setup().stdin.listenerCount('data')).toBe(0)

    Object.assign(environment, { isCI: false, isTest: true })
    expect(setup().stdin.listenerCount('data')).toBe(0)
  })

  it('should take stdin out of raw mode', async () => {
    const { stdin, listener, press } = setup({}, { isRaw: true })

    expect(stdin.setRawMode).toHaveBeenCalledWith(false)

    await press('u')
    await vi.waitFor(() => expect(listener.showURLs).toHaveBeenCalled())
  })

  it('should distinguish `q` from `qr`', async () => {
    const close = vi.fn(async () => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const { press } = setup({ close })

    await press('qr')
    await vi.waitFor(() => expect(printQRCode).toHaveBeenCalledWith('http://localhost:3000/', { showURL: true }))
    expect(close).not.toHaveBeenCalled()

    await press('q')
    await vi.waitFor(() => expect(close).toHaveBeenCalled())
    expect(exit).toHaveBeenCalled()
  })

  it('should share the most reachable url', async () => {
    const listener = {
      url: 'http://localhost:3000/',
      qrURL: 'http://192.168.1.20:3000/',
      publicURL: 'https://example.com/',
      getURLs: () => [],
      showURLs: vi.fn(),
    } as unknown as Listener
    const { press } = setup({ listener })

    await press('copy')
    await vi.waitFor(() => expect(copyURL).toHaveBeenCalledWith('http://192.168.1.20:3000/'))
  })

  it('should fall back to a network url when sharing', async () => {
    const listener = {
      url: 'http://localhost:3000/',
      getURLs: () => [
        { url: 'http://localhost:3000/', type: 'local' },
        { url: 'http://192.168.1.20:3000/', type: 'network' },
      ],
      showURLs: vi.fn(),
    } as unknown as Listener
    const { press } = setup({ listener })

    await press('copy')
    await vi.waitFor(() => expect(copyURL).toHaveBeenCalledWith('http://192.168.1.20:3000/'))
  })

  it('should restart when a restart handler is available', async () => {
    const restart = vi.fn()
    const { press } = setup({ restart })

    await press('r')
    await vi.waitFor(() => expect(restart).toHaveBeenCalled())
  })

  it('should ignore the restart shortcut when no handler is available', async () => {
    const { press, listener } = setup()

    await press('r')

    expect(listener.showURLs).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('should report a failure to quit and exit non-zero', async () => {
    const exitCode = process.exitCode
    restores.push(() => {
      process.exitCode = exitCode
    })

    const close = vi.fn().mockRejectedValue(new Error('could not close'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { press } = setup({ close })

    await press('q')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'could not close' }))
    expect(process.exitCode).toBe(1)
  })

  it('should report a failing shortcut without exiting', async () => {
    const listener = {
      url: 'http://localhost:3000/',
      getURLs: () => [],
      showURLs: vi.fn(() => {
        throw new Error('boom')
      }),
    } as unknown as Listener
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { press } = setup({ listener })

    await press('urls')

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' })))
  })

  it('should ignore unknown input', async () => {
    const { press, listener } = setup()

    await press('nonsense')

    expect(listener.showURLs).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    expect(copyURL).not.toHaveBeenCalled()
  })
})
