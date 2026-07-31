import { describe, expect, it, vi } from 'vitest'

const evaluated = vi.hoisted(() => new Set<string>())

vi.mock('../../src/dev/cert', () => {
  evaluated.add('cert')
  return { resolveCertificate: vi.fn(async () => false) }
})

vi.mock('../../src/dev/tunnel', () => {
  evaluated.add('tunnel')
  return { startTunnel: vi.fn(async () => ({ url: 'https://example.test', close: async () => {} })) }
})

describe('listen module graph', () => {
  it('should not evaluate the certificate or tunnel modules unless the options ask for them', async () => {
    const { listen } = await import('../../src/dev/listen')
    expect([...evaluated]).toEqual([])

    const listener = await listen((_req, res) => res.end('ok'), { port: 0, showURL: false })
    try {
      expect([...evaluated]).toEqual([])
    }
    finally {
      await listener.close()
    }
  })

  it('should pull in the certificate module when https is requested', async () => {
    const { listen } = await import('../../src/dev/listen')

    const listener = await listen((_req, res) => res.end('ok'), { port: 0, https: true, showURL: false })
    try {
      expect(evaluated.has('cert')).toBe(true)
      expect(evaluated.has('tunnel')).toBe(false)
    }
    finally {
      await listener.close()
    }
  })
})
