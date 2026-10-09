import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'

const identity = { id: 'id', hostname: 'abc123.opentunnel.xyz', token: 't', privateKey: 'k', certificate: 'c', chain: 'ch', certificateExpiry: new Date(0) }

function createConnection() {
  return {
    tunnel: identity,
    events: (async function* () {})(),
    closed: new Promise<void>(() => {}),
    close: vi.fn(async () => {}),
  }
}

const client = {
  tunnel: {
    get: vi.fn(),
    pending: vi.fn(),
    resume: vi.fn(),
    create: vi.fn(),
    connect: vi.fn(),
  },
  dispose: vi.fn(async () => {}),
}

const loadOpenTunnelSDK = vi.fn(async (_rootDir: string) => ({ create: () => client }) as unknown)
vi.mock('../../../src/dev/tunnel/opentunnel-loader', () => ({ loadOpenTunnelSDK }))

const startCloudflaredTunnel = vi.fn(async (url: string) => ({ url: `cloudflared:${url}`, close: async () => {} }))
vi.mock('../../../src/dev/tunnel/cloudflared', () => ({ startCloudflaredTunnel }))

const { startOpenTunnel } = await import('../../../src/dev/tunnel/opentunnel')
const { formatTunnelTarget, startTunnel } = await import('../../../src/dev/tunnel')

beforeEach(() => {
  client.tunnel.get.mockResolvedValue(identity)
  client.tunnel.pending.mockResolvedValue(undefined)
  client.tunnel.create.mockResolvedValue(identity)
  client.tunnel.connect.mockImplementation(async () => createConnection())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const fn of [...Object.values(client.tunnel), client.dispose, startCloudflaredTunnel, loadOpenTunnelSDK]) {
    fn.mockClear()
  }
})

describe('startOpenTunnel', () => {
  it('should route the project to the dev server and close the bridge on close', async () => {
    const tunnel = await startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })

    expect(client.tunnel.connect).toHaveBeenCalledWith({ routes: { route: 'localhost:3000' } })
    expect(client.tunnel.create).not.toHaveBeenCalled()
    expect(tunnel?.url).toBe('https://route.abc123.opentunnel.xyz')

    const connection = await client.tunnel.connect.mock.results[0]!.value
    await tunnel!.close()
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(client.dispose).toHaveBeenCalledTimes(1)
  })

  it('should create the tunnel on the first run, with progress', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'success').mockImplementation(() => {})
    client.tunnel.get.mockResolvedValue(undefined)
    client.tunnel.create.mockImplementation(async ({ onProgress }: { onProgress: (stage: string) => void }) => {
      onProgress('creating-tunnel')
      onProgress('waiting-certificate')
      return identity
    })

    const tunnel = await startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })

    expect(client.tunnel.create).toHaveBeenCalledTimes(1)
    expect(tunnel?.url).toBe('https://route.abc123.opentunnel.xyz')
  })

  it('should finish a tunnel an earlier run left waiting for its certificate', async () => {
    vi.spyOn(logger, 'success').mockImplementation(() => {})
    client.tunnel.get.mockResolvedValue(undefined)
    client.tunnel.pending.mockResolvedValue({ id: 'id', hostname: identity.hostname })
    client.tunnel.resume.mockResolvedValue(identity)

    await startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })

    expect(client.tunnel.resume).toHaveBeenCalledTimes(1)
    expect(client.tunnel.create).not.toHaveBeenCalled()
  })

  it('should keep serving without a tunnel when the client cannot be loaded', async () => {
    loadOpenTunnelSDK.mockResolvedValueOnce(undefined)

    await expect(startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })).resolves.toBeUndefined()

    expect(client.tunnel.connect).not.toHaveBeenCalled()
  })

  it('should warn and keep serving without a tunnel when it cannot connect', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    client.tunnel.connect.mockRejectedValue(new Error('invalid token'))

    await expect(startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid token'))
    expect(client.dispose).toHaveBeenCalledTimes(1)
  })

  it('should give up on a bridge that never attaches', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    client.tunnel.connect.mockReturnValue(new Promise(() => {}))

    const started = startOpenTunnel('route', 'localhost:3000', { rootDir: '/app' })
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(started).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Timed out connecting'))
  })

  it('should not wait for the route during a handover, as the outgoing server still holds it', async () => {
    let attach: ((connection: ReturnType<typeof createConnection>) => void) | undefined
    client.tunnel.connect.mockReturnValue(new Promise((resolve) => {
      attach = resolve
    }))

    const tunnel = await startOpenTunnel('route', 'localhost:3000', { rootDir: '/app', handover: true })
    expect(tunnel?.url).toBe('https://route.abc123.opentunnel.xyz')

    const connection = createConnection()
    attach!(connection)
    await vi.waitFor(() => expect(client.tunnel.connect).toHaveBeenCalledTimes(1))
    await tunnel!.close()
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(client.dispose).toHaveBeenCalledTimes(1)
  })

  it('should drop a bridge that attaches after a handover tunnel was closed', async () => {
    let attach: ((connection: ReturnType<typeof createConnection>) => void) | undefined
    client.tunnel.connect.mockReturnValue(new Promise((resolve) => {
      attach = resolve
    }))

    const tunnel = await startOpenTunnel('route', 'localhost:3000', { rootDir: '/app', handover: true })
    await tunnel!.close()
    expect(client.dispose).toHaveBeenCalledTimes(1)

    const connection = createConnection()
    attach!(connection)
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledTimes(1))
  })
})

describe('startTunnel', () => {
  it('should start a Cloudflare quick tunnel', async () => {
    await startTunnel({ provider: 'cloudflare' }, { protocol: 'https', hostname: '', port: 3000 })
    expect(startCloudflaredTunnel).toHaveBeenCalledWith('https://localhost:3000', true)
  })

  it('should start OpenTunnel with the resolved route', async () => {
    const tunnel = await startTunnel({ provider: 'opentunnel', route: 'route', rootDir: '/app' }, { protocol: 'http', hostname: '', port: 3000 })
    expect(tunnel?.url).toBe('https://route.abc123.opentunnel.xyz')
    expect(loadOpenTunnelSDK).toHaveBeenCalledWith('/app')
    expect(startCloudflaredTunnel).not.toHaveBeenCalled()
  })

  it('should fall back to Cloudflare for an HTTPS dev server, which OpenTunnel cannot forward to', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await startTunnel({ provider: 'opentunnel', route: 'route', rootDir: '/app' }, { protocol: 'https', hostname: '', port: 3000 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot forward to an HTTPS dev server'))
    expect(startCloudflaredTunnel).toHaveBeenCalledWith('https://localhost:3000', true)
    expect(client.tunnel.connect).not.toHaveBeenCalled()
  })

  it('should reach a server bound to one address through that address', async () => {
    await startTunnel({ provider: 'opentunnel', route: 'route', rootDir: '/app' }, { protocol: 'http', hostname: '192.168.1.5', port: 3000 })
    expect(client.tunnel.connect).toHaveBeenCalledWith({ routes: { route: '192.168.1.5:3000' } })

    await startTunnel({ provider: 'cloudflare' }, { protocol: 'http', hostname: '192.168.1.5', port: 3000 })
    expect(startCloudflaredTunnel).toHaveBeenCalledWith('http://192.168.1.5:3000', false)
  })
})

describe('formatTunnelTarget', () => {
  it('should use localhost for a server on every interface', () => {
    for (const hostname of ['', '0.0.0.0', '::']) {
      expect(formatTunnelTarget({ hostname, port: 3000 }), hostname).toBe('localhost:3000')
    }
  })

  it('should use the address a server is bound to, with IPv6 in brackets', () => {
    expect(formatTunnelTarget({ hostname: 'localhost', port: 3000 })).toBe('localhost:3000')
    expect(formatTunnelTarget({ hostname: '192.168.1.5', port: 3000 })).toBe('192.168.1.5:3000')
    // `localhost` can resolve to 127.0.0.1, where a server bound to `::1` does not listen.
    expect(formatTunnelTarget({ hostname: '::1', port: 3000 })).toBe('[::1]:3000')
    expect(formatTunnelTarget({ hostname: 'fe80::1', port: 3000 })).toBe('[fe80::1]:3000')
  })
})
