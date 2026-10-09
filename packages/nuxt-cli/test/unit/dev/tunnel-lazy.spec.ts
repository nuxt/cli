import { describe, expect, it, vi } from 'vitest'

const evaluated = vi.hoisted(() => new Set<string>())

vi.mock('../../../src/dev/tunnel/cloudflared', () => {
  evaluated.add('cloudflared')
  return { startCloudflaredTunnel: vi.fn(async () => ({ url: 'https://example.test', close: async () => {} })) }
})

// The OpenTunnel SDK and `effect` are most of the CLI's install size, so only
// `--tunnel=opentunnel` may load them.
vi.mock('../../../src/dev/tunnel/opentunnel', () => {
  evaluated.add('opentunnel')
  return { startOpenTunnel: vi.fn(async () => ({ url: 'https://example.test', close: async () => {} })) }
})

describe('tunnel module graph', () => {
  it('should load only the provider that was asked for', async () => {
    const { startTunnel } = await import('../../../src/dev/tunnel')
    expect([...evaluated]).toEqual([])

    await startTunnel({ provider: 'cloudflare' }, { protocol: 'http', port: 3000 })
    expect([...evaluated]).toEqual(['cloudflared'])

    await startTunnel({ provider: 'opentunnel', route: 'route', rootDir: '/app' }, { protocol: 'http', port: 3000 })
    expect([...evaluated]).toEqual(['cloudflared', 'opentunnel'])
  })
})
