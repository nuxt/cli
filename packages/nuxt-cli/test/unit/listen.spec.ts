import { networkInterfaces } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { getNetworkAddresses } from '../../src/dev/listen'

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
