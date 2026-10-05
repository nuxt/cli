import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'

import { attachViteHmrServer } from '../../src/dev/utils'

const hmrServer = {} as Server

describe('attachViteHmrServer', () => {
  it('pins the dev server on both ws and hmr with no separate port', () => {
    const server: Record<string, unknown> = {}

    attachViteHmrServer(server, hmrServer)

    for (const key of ['ws', 'hmr'] as const) {
      expect(server[key]).toMatchObject({
        protocol: undefined,
        port: undefined,
        host: undefined,
        server: hmrServer,
      })
    }
  })

  it('preserves user-set ws and hmr options other than server/port/host', () => {
    const server: Record<string, unknown> = {
      ws: { clientPort: 1234 },
      hmr: { overlay: false },
    }

    attachViteHmrServer(server, hmrServer)

    expect(server.ws).toMatchObject({ clientPort: 1234, server: hmrServer, port: undefined, host: undefined })
    expect(server.hmr).toMatchObject({ overlay: false, server: hmrServer, port: undefined, host: undefined })
  })

  it('does not crash when ws or hmr is set to false', () => {
    const server: Record<string, unknown> = { ws: false, hmr: false }

    expect(() => attachViteHmrServer(server, hmrServer)).not.toThrow()

    expect(server.ws).toMatchObject({ server: hmrServer })
    expect(server.hmr).toMatchObject({ server: hmrServer })
  })

  it.each([
    ['ws', { ws: { path: 'hmr' } }],
    ['hmr', { hmr: { path: 'hmr' } }],
  ])('sets a %s path on both ws and hmr and returns it', (_key, server: Record<string, any>) => {
    expect(attachViteHmrServer(server, hmrServer)).toBe('hmr')
    expect(server.ws.path).toBe('hmr')
    expect(server.hmr.path).toBe('hmr')
  })

  it('prefers the ws path when both are set', () => {
    const server: Record<string, any> = { ws: { path: 'a' }, hmr: { path: 'b' } }

    expect(attachViteHmrServer(server, hmrServer)).toBe('a')
    expect(server.hmr.path).toBe('a')
  })
})
