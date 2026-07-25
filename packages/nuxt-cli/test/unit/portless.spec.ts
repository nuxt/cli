import { describe, expect, it } from 'vitest'

import { resolvePortlessURLs } from '../../src/dev/portless'

describe('resolvePortlessURLs', () => {
  it('should return no urls when not running under portless', () => {
    expect(resolvePortlessURLs({})).toStrictEqual({ url: undefined, shareURL: undefined, all: [] })
  })

  it('should normalise the proxy url to an origin', () => {
    const result = resolvePortlessURLs({ PORTLESS_URL: 'https://myapp.localhost/' })
    expect(result.url).toBe('https://myapp.localhost')
    expect(result.all).toStrictEqual(['https://myapp.localhost'])
  })

  it('should prefer ngrok over tailscale for the share url', () => {
    const result = resolvePortlessURLs({
      PORTLESS_URL: 'https://myapp.localhost',
      PORTLESS_NGROK_URL: 'https://abc123.ngrok.app',
      PORTLESS_TAILSCALE_URL: 'https://devbox.tail1234.ts.net',
    })
    expect(result.shareURL).toBe('https://abc123.ngrok.app')
    expect(result.all).toStrictEqual(['https://myapp.localhost', 'https://abc123.ngrok.app'])
  })

  it('should fall back to tailscale for the share url', () => {
    const result = resolvePortlessURLs({ PORTLESS_TAILSCALE_URL: 'https://devbox.tail1234.ts.net:8443' })
    expect(result.shareURL).toBe('https://devbox.tail1234.ts.net:8443')
  })

  it('should ignore malformed urls', () => {
    expect(resolvePortlessURLs({ PORTLESS_URL: 'myapp.localhost' }).all).toStrictEqual([])
  })
})
