import { networkInterfaces } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { getNetworkAddresses, resolveOpenCommand } from '../../src/dev/listen'

vi.mock('node:os', () => ({
  networkInterfaces: vi.fn(),
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
