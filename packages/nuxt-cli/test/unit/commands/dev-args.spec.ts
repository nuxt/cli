import { afterEach, describe, expect, it, vi } from 'vitest'

import { parsePositiveInteger, resolveListenOverrides } from '../../../src/commands/dev'

function overrides(args: Record<string, unknown> = {}) {
  return resolveListenOverrides({ _: [], ...args } as never)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveListenOverrides', () => {
  it('should leave the hostname unset when no host is requested', () => {
    expect(overrides().hostname).toBeUndefined()
  })

  it('should treat a bare --host as every interface', () => {
    expect(overrides({ host: true }).hostname).toBe('')
    expect(overrides({ host: '' }).hostname).toBe('')
  })

  it('should keep an explicit host', () => {
    expect(overrides({ host: '127.0.0.1' }).hostname).toBe('127.0.0.1')
  })

  it('should prefer an explicit host over the environment', () => {
    vi.stubEnv('NUXT_HOST', '0.0.0.0')
    expect(overrides({ host: '127.0.0.1' }).hostname).toBe('127.0.0.1')
  })

  it('should read the host from the environment in precedence order', () => {
    vi.stubEnv('HOST', 'from-host')
    expect(overrides().hostname).toBe('from-host')
    vi.stubEnv('NITRO_HOST', 'from-nitro')
    expect(overrides().hostname).toBe('from-nitro')
    vi.stubEnv('NUXT_HOST', 'from-nuxt')
    expect(overrides().hostname).toBe('from-nuxt')
  })

  it('should read the port from the environment in precedence order', () => {
    vi.stubEnv('PORT', '4000')
    expect(overrides().port).toBe('4000')
    vi.stubEnv('NUXT_PORT', '5000')
    expect(overrides().port).toBe('5000')
    expect(overrides({ port: '6000' }).port).toBe('6000')
  })

  it('should open the browser when only --open.url is given', () => {
    expect(overrides({ 'open.url': '/admin' })).toMatchObject({ open: true, openURL: '/admin' })
    expect(overrides().open).toBeFalsy()
  })

  it('should split https domains and drop empty entries', () => {
    expect(overrides({ 'https.domains': 'a.test, b.test ,' }).https).toMatchObject({ domains: ['a.test', 'b.test'] })
  })

  it('should leave https domains unset when the flag is absent', () => {
    expect((overrides().https as { domains?: string[] }).domains).toBeUndefined()
  })

  it('should fall back to the deprecated ssl flags and env vars', () => {
    vi.stubEnv('NITRO_SSL_KEY', '/env/key.pem')
    expect(overrides({ sslCert: '/cert.pem' }).https).toMatchObject({ cert: '/cert.pem', key: '/env/key.pem' })
  })
})

describe('parsePositiveInteger', () => {
  it('should accept a positive integer', () => {
    expect(parsePositiveInteger('30')).toBe(30)
  })

  it('should reject anything else', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc']) {
      expect(parsePositiveInteger(value), String(value)).toBeUndefined()
    }
  })
})
