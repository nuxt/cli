import type { Listener } from '../../src/dev/listen'

import { networkInterfaces } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyURL, getNetworkAddresses, listen, resolveOpenCommand } from '../../src/dev/listen'

const writeText = vi.hoisted(() => vi.fn())

vi.mock('tinyclip', () => ({ writeText }))

const spawn = vi.hoisted(() => vi.fn((_command: string, _args: string[]) => ({ on: () => ({ unref: () => {} }) })))

vi.mock('node:child_process', () => ({ spawn }))

vi.mock('node:os', () => ({
  networkInterfaces: vi.fn(() => ({})),
  release: () => 'test',
}))

const mocked = vi.mocked(networkInterfaces)

describe('getNetworkAddresses', () => {
  it('should return external IPv4 addresses', () => {
    mocked.mockReturnValue({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
      en0: [
        { address: '192.168.1.20', family: 'IPv4', internal: false } as any,
        { address: 'fe80::1', family: 'IPv6', internal: false } as any,
      ],
    })

    expect(getNetworkAddresses()).toEqual(['192.168.1.20'])
  })

  it('should ignore IPv4 link-local addresses', () => {
    mocked.mockReturnValue({
      bridge0: [{ address: '169.254.13.37', family: 'IPv4', internal: false } as any],
      en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false } as any],
    })

    expect(getNetworkAddresses()).toEqual(['192.168.1.20'])
  })
})

describe('resolveOpenCommand', () => {
  const url = 'http://localhost:3000/'

  it('should use the platform default when `BROWSER` is unset', () => {
    expect(resolveOpenCommand(url, 'darwin', {})).toEqual(['open', [url]])
    expect(resolveOpenCommand(url, 'linux', {})).toEqual(['xdg-open', [url]])
    expect(resolveOpenCommand(url, 'win32', {})).toEqual(['cmd.exe', ['/c', 'start', '""', url]])
  })

  it('should open via `cmd.exe` on WSL', () => {
    expect(resolveOpenCommand(url, 'linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toEqual(['cmd.exe', ['/c', 'start', '""', url]])
  })

  it('should not open anything for `BROWSER=none`', () => {
    expect(resolveOpenCommand(url, 'linux', { BROWSER: 'none' })).toBeUndefined()
  })

  it('should respect `BROWSER` and `BROWSER_ARGS`', () => {
    expect(resolveOpenCommand(url, 'linux', { BROWSER: 'firefox' })).toEqual(['firefox', [url]])
    expect(resolveOpenCommand(url, 'linux', { BROWSER: 'firefox', BROWSER_ARGS: '--private-window' })).toEqual(['firefox', ['--private-window', url]])
  })

  it('should launch a named application with `open -a` on macOS', () => {
    expect(resolveOpenCommand(url, 'darwin', { BROWSER: 'Firefox' })).toEqual(['open', ['-a', 'Firefox', url]])
    expect(resolveOpenCommand(url, 'darwin', { BROWSER: 'Firefox', BROWSER_ARGS: '--private-window' })).toEqual(['open', ['-a', 'Firefox', url, '--args', '--private-window']])
    expect(resolveOpenCommand(url, 'darwin', { BROWSER: '/usr/local/bin/firefox' })).toEqual(['/usr/local/bin/firefox', [url]])
  })
})

describe('listen', () => {
  const listeners: Listener[] = []

  afterEach(async () => {
    await Promise.all(listeners.splice(0).map(listener => listener.close()))
  })

  async function start(options: Parameters<typeof listen>[1]) {
    const listener = await listen((_req, res) => res.end('ok'), { showURL: false, ...options })
    listeners.push(listener)
    return listener
  }

  it('should fall back to another port by default', async () => {
    const first = await start({ port: 0 })
    const second = await start({ port: first.address.port })

    expect(second.address.port).not.toBe(first.address.port)
  })

  it('should throw for a busy port with `strictPort`', async () => {
    const first = await start({ port: 0 })

    await expect(start({ port: first.address.port, strictPort: true })).rejects.toThrow(/already in use/)
  })

  it('should open the dev server URL', async () => {
    const listener = await start({ port: 0, open: true })

    expect(spawn.mock.lastCall?.[1]).toContain(listener.url)
  })

  it('should open a path or URL relative to the dev server', async () => {
    const listener = await start({ port: 0, open: true, openURL: '/dashboard' })
    expect(spawn.mock.lastCall?.[1]).toContain(`${listener.url}dashboard`)

    await start({ port: 0, open: true, openURL: 'https://example.com/foo' })
    expect(spawn.mock.lastCall?.[1]).toContain('https://example.com/foo')
  })

  it('should use the requested port with `strictPort`', async () => {
    const { address } = await start({ port: 0 })
    const port = address.port
    await Promise.all(listeners.splice(0).map(listener => listener.close()))

    const listener = await start({ port, strictPort: true })
    expect(listener.address.port).toBe(port)
  })
})

describe('copyURL', () => {
  const platform = process.platform
  const env = { ...process.env }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    process.env = { ...env }
    vi.clearAllMocks()
  })

  function stubPlatform(value: NodeJS.Platform, overrides: NodeJS.ProcessEnv = {}) {
    Object.defineProperty(process, 'platform', { value, configurable: true })
    process.env = { ...env, DISPLAY: undefined, WAYLAND_DISPLAY: undefined, WSL_DISTRO_NAME: undefined, ...overrides }
  }

  it('should skip copying without a display server on linux', async () => {
    stubPlatform('linux')

    await copyURL('http://localhost:3000/')

    expect(writeText).not.toHaveBeenCalled()
  })

  it('should copy when a display server is available', async () => {
    stubPlatform('linux', { DISPLAY: ':0' })

    await copyURL('http://localhost:3000/')

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/')
  })

  it('should copy on platforms that do not need a display server', async () => {
    stubPlatform('darwin')

    await copyURL('http://localhost:3000/')

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/')
  })

  it('should warn rather than throw when copying fails', async () => {
    stubPlatform('darwin')
    writeText.mockRejectedValueOnce(new Error('no clipboard tool found'))

    await expect(copyURL('http://localhost:3000/')).resolves.toBeUndefined()
  })
})
