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

vi.mock('std-env', () => ({ isCI: false, isTest: false }))

describe('setupShortcuts', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    for (const restore of restores.splice(0)) {
      restore()
    }
    vi.restoreAllMocks()
  })

  function setup(context: Partial<ShortcutContext> = {}, { isTTY = true } = {}) {
    const stdin = new PassThrough() as unknown as typeof process.stdin
    Object.assign(stdin, { isTTY })

    const original = process.stdin
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    restores.push(() => Object.defineProperty(process, 'stdin', { value: original, configurable: true }))

    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation(message => void logs.push(String(message)))

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

    const press = async (input: string) => {
      stdin.write(`${input}\n`)
      await new Promise(resolve => setImmediate(resolve))
    }

    return { context: resolved, listener, logs, press, stdin }
  }

  it('should do nothing when stdin is not a TTY', () => {
    const { logs, stdin } = setup({}, { isTTY: false })

    expect(logs).toHaveLength(0)
    expect(stdin.listenerCount('line')).toBe(0)
  })

  it('should hint at the help shortcut once ready', () => {
    const { logs } = setup()

    expect(logs.join('\n')).toContain('h + enter')
  })

  it('should open the browser and show urls', async () => {
    const { listener, press } = setup()

    await press('o')
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledWith('http://localhost:3000/'))

    await press('urls')
    expect(listener.showURLs).toHaveBeenCalled()
  })

  it('should reprint the urls after clearing the console', async () => {
    const { listener, press } = setup()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await press('clear')

    expect(write).toHaveBeenCalledWith('\u001B[2J\u001B[3J\u001B[H')
    expect(listener.showURLs).toHaveBeenCalled()
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

  it('should prefer a network url for sharing', async () => {
    const listener = {
      url: 'http://localhost:3000/',
      qrURL: 'http://192.168.1.20:3000/',
      getURLs: () => [],
      showURLs: vi.fn(),
    } as unknown as Listener
    const { press } = setup({ listener })

    await press('copy')
    await vi.waitFor(() => expect(copyURL).toHaveBeenCalledWith('http://192.168.1.20:3000/'))
  })

  it('should restart when a restart handler is available', async () => {
    const restart = vi.fn()
    const { press, logs } = setup({ restart })

    await press('r')
    expect(restart).toHaveBeenCalled()

    await press('h')
    expect(logs.join('\n')).toContain('restart the dev server')
  })

  it('should hide the restart shortcut when unavailable', async () => {
    const { press, logs } = setup()

    await press('h')
    expect(logs.join('\n')).not.toContain('restart the dev server')
    expect(logs.join('\n')).toContain('quit')
  })
})
