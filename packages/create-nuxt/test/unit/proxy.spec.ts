import { afterEach, describe, expect, it, vi } from 'vitest'

import { setGlobalProxyFromEnv, startTunnelProxy } from '../../../nuxt-cli/test/utils/proxy'

describe.skipIf(!setGlobalProxyFromEnv)('proxy support', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    ['create-nuxt', () => import('../../src/main')],
    ['nuxi', () => import('../../../nuxi/src/main')],
  ])('should route %s requests through HTTP_PROXY', async (_name, load) => {
    const proxy = await startTunnelProxy()
    try {
      for (const key of ['HTTPS_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS']) {
        vi.stubEnv(key, undefined)
      }
      vi.stubEnv('HTTP_PROXY', proxy.proxyUrl)
      await load()
      expect(await fetch('http://nuxt.invalid/').then(r => r.text())).toBe('ok')
      expect(proxy.tunnelled).toEqual(['nuxt.invalid:80'])
    }
    finally {
      proxy.close()
    }
  })
})
