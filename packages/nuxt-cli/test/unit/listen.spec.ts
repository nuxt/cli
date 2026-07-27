import type { Listener } from '../../src/dev/listen'

import { networkInterfaces } from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyURL, formatDisplayURL, getNetworkAddresses, listen, openBrowser, resolveOpenCommand, validateHostname } from '../../src/dev/listen'

const writeText = vi.hoisted(() => vi.fn())

vi.mock('tinyclip', () => ({ writeText }))

const spawn = vi.hoisted(() => vi.fn((_command: string, _args: string[]) => ({
  once: () => {},
  off: () => {},
  unref: () => {},
})))

vi.mock('node:child_process', () => ({ spawn }))

vi.mock('node:os', () => ({
  networkInterfaces: vi.fn(() => ({})),
  release: () => 'test',
}))

const mocked = vi.mocked(networkInterfaces)

const realPlatform = process.platform
const realEnv = { ...process.env }

/** Pretend to run on `platform`, with only the display variables in `env` set. */
function stubEnvironment(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  process.env = { ...realEnv, DISPLAY: undefined, WAYLAND_DISPLAY: undefined, WSL_DISTRO_NAME: undefined, ...env }
}

function restoreEnvironment() {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  process.env = { ...realEnv }
}

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

describe('formatDisplayURL', () => {
  it('should include a non-default port', () => {
    expect(formatDisplayURL('http', 'localhost', 3000, '/')).toBe('http://localhost:3000/')
    expect(formatDisplayURL('https', 'localhost', 8443, '/')).toBe('https://localhost:8443/')
  })

  it('should omit the default port for the protocol', () => {
    expect(formatDisplayURL('http', 'localhost', 80, '/')).toBe('http://localhost/')
    expect(formatDisplayURL('https', 'localhost', 443, '/')).toBe('https://localhost/')
    expect(formatDisplayURL('https', 'localhost', 80, '/')).toBe('https://localhost:80/')
  })

  it('should bracket ipv6 hosts', () => {
    expect(formatDisplayURL('http', '::1', 3000, '/')).toBe('http://[::1]:3000/')
  })

  it('should decode a percent-encoded base url', () => {
    expect(formatDisplayURL('http', 'localhost', 3000, '/%C3%A9t%C3%A9/')).toBe('http://localhost:3000/été/')
  })

  it('should leave a malformed encoding alone', () => {
    expect(formatDisplayURL('http', 'localhost', 3000, '/%E0%A4%A/')).toBe('http://localhost:3000/%E0%A4%A/')
  })
})

describe('validateHostname', () => {
  it('should pass through valid hosts', () => {
    expect(validateHostname('localhost')).toBe('localhost')
    expect(validateHostname('127.0.0.1')).toBe('127.0.0.1')
    expect(validateHostname('::1')).toBe('::1')
    expect(validateHostname('my-app.example.com')).toBe('my-app.example.com')
    expect(validateHostname('')).toBe('')
    expect(validateHostname(undefined)).toBeUndefined()
  })

  it('should fall back to `localhost` for an invalid host', () => {
    expect(validateHostname('local host')).toBe('localhost')
    expect(validateHostname('http://localhost')).toBe('localhost')
    expect(validateHostname('-nope')).toBe('localhost')
    expect(validateHostname(`${'a'.repeat(64)}.com`)).toBe('localhost')
  })

  it('should fall back to all interfaces when public', () => {
    expect(validateHostname('local host', true)).toBe('')
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

  // `openBrowser` refuses to spawn a launcher without a graphical session.
  beforeEach(() => stubEnvironment(realPlatform, { DISPLAY: ':0' }))

  afterEach(async () => {
    restoreEnvironment()
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

    await expect(start({ port: first.address.port, strictPort: true })).rejects.toThrow(`Port ${first.address.port} is already in use (\`--strictPort\` is enabled).`)
  })

  it('should explain an unavailable host', async () => {
    await expect(start({ port: 34567, hostname: '203.0.113.1', strictPort: true })).rejects.toThrow(/is not an address of this machine/)
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

  it('should bind a fallback host for an invalid `hostname`', async () => {
    const listener = await start({ port: 0, hostname: 'not a host' })

    expect(listener.url).toBe(`http://localhost:${listener.address.port}/`)
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
  afterEach(() => {
    restoreEnvironment()
    vi.clearAllMocks()
  })

  it('should skip copying without a display server on linux', async () => {
    stubEnvironment('linux')

    await copyURL('http://localhost:3000/')

    expect(writeText).not.toHaveBeenCalled()
  })

  it('should copy when a display server is available', async () => {
    stubEnvironment('linux', { DISPLAY: ':0' })

    await copyURL('http://localhost:3000/')

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/')
  })

  it('should copy on platforms that do not need a display server', async () => {
    stubEnvironment('darwin')

    await copyURL('http://localhost:3000/')

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/')
  })

  it('should warn rather than throw when copying fails', async () => {
    stubEnvironment('darwin')
    writeText.mockRejectedValueOnce(new Error('no clipboard tool found'))

    await expect(copyURL('http://localhost:3000/')).resolves.toBeUndefined()
  })
})

describe('openBrowser', () => {
  afterEach(() => {
    restoreEnvironment()
    vi.clearAllMocks()
  })

  it('should not spawn a launcher without a display server', () => {
    stubEnvironment('linux')

    openBrowser('http://localhost:3000/')

    expect(spawn).not.toHaveBeenCalled()
  })

  it('should spawn a launcher when a display server is available', () => {
    stubEnvironment('linux', { DISPLAY: ':0' })

    openBrowser('http://localhost:3000/')

    expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://localhost:3000/'], expect.anything())
  })
})
