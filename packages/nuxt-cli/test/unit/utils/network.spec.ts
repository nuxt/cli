import type { AddressInfo } from 'node:net'

import { createServer } from 'node:http'
import { stripVTControlCharacters } from 'node:util'

import { downloadTemplate } from 'giget'
import { $fetch } from 'ofetch'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const logs: Array<[string, string]> = []

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    error: (message: string) => logs.push(['error', message]),
    info: (message: string) => logs.push(['info', message]),
    warn: (message: string) => logs.push(['warn', message]),
  },
  debug: () => {},
}))

const { classifyNetworkError, describeNetworkError, formatRetryCommand, getProxyHint, hasProxyEnv, isEnvProxyActive, logNetworkError, probeNetworkError, setupProxySupport, supportsEnvProxy } = await import('../../../src/utils/network')

const NUXI_ARGV = ['/usr/bin/node', '/project/node_modules/.bin/nuxi.mjs', 'init', 'my app']

function clean(message: string) {
  return stripVTControlCharacters(message)
}

function withCode(code: string, message = 'fetch failed') {
  return Object.assign(new Error(message), { cause: Object.assign(new Error(code), { code }) })
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  }
  catch (err) {
    return err
  }
  throw new Error('expected the request to fail')
}

// `setupProxySupport` caches whether the current process is proxy-aware, so tests
// must not inherit each other's state (or the ambient environment's).
beforeEach(() => {
  setupProxySupport({})
})

describe('hasProxyEnv', () => {
  it('detects lower and upper case variants', () => {
    expect(hasProxyEnv({})).toBe(false)
    expect(hasProxyEnv({ http_proxy: 'http://localhost:3128' })).toBe(true)
    expect(hasProxyEnv({ HTTPS_PROXY: 'http://localhost:3128' })).toBe(true)
    expect(hasProxyEnv({ NO_PROXY: 'internal.example.com' })).toBe(false)
  })
})

describe('setupProxySupport', () => {
  it('does nothing without proxy environment variables', () => {
    const env = {}
    expect(setupProxySupport(env)).toBe('unused')
    expect(env).toEqual({})
  })

  it('never overrides an explicit NODE_USE_ENV_PROXY', () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '0' }
    setupProxySupport(env)
    expect(env.NODE_USE_ENV_PROXY).toBe('0')
  })

  it('propagates proxy support to child processes', () => {
    const env = { HTTP_PROXY: 'http://localhost:3128' } as NodeJS.ProcessEnv
    const result = setupProxySupport(env)
    if (supportsEnvProxy()) {
      expect(result).toBe('children-only')
      expect(env.NODE_USE_ENV_PROXY).toBe('1')
    }
    else {
      expect(result).toBe('unsupported')
      expect(env.NODE_USE_ENV_PROXY).toBeUndefined()
    }
  })

  it('detects support from the flags Node.js accepts', () => {
    expect(supportsEnvProxy(new Set(['--use-env-proxy']))).toBe(true)
    expect(supportsEnvProxy(new Set(['--enable-source-maps']))).toBe(false)
    expect(supportsEnvProxy({ has: () => false })).toBe(false)
  })

  it('reports the current process as proxy-aware when launched with the flag', () => {
    if (!supportsEnvProxy()) {
      return
    }
    expect(isEnvProxyActive({ NODE_USE_ENV_PROXY: '1' }, [])).toBe(true)
    expect(isEnvProxyActive({ NODE_OPTIONS: '--use-env-proxy' }, [])).toBe(true)
    expect(isEnvProxyActive({}, ['--use-env-proxy'])).toBe(true)
    expect(isEnvProxyActive({ HTTPS_PROXY: 'http://localhost:3128' }, [])).toBe(false)
    expect(setupProxySupport({ HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' })).toBe('active')
  })
})

describe('describeNetworkError with real failures', () => {
  const server = createServer((req, res) => {
    if (req.url?.includes('slow')) {
      setTimeout(() => res.end('{}'), 500).unref()
      return
    }
    res.writeHead(req.url?.includes('teapot') ? 418 : 404, { 'content-type': 'application/json' })
    res.end('{}')
  })

  let port = 0
  let closedPort = 0

  beforeAll(async () => {
    port = await new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))

    // Bind then release a port so connections to it are refused rather than
    // rejected by undici's bad-port list (which is what happens for port 1).
    const spare = createServer()
    closedPort = await new Promise<number>(resolve => spare.listen(0, '127.0.0.1', () => resolve((spare.address() as AddressInfo).port)))
    await new Promise<void>(resolve => spare.close(() => resolve()))
  })

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('describes a real refused connection from `fetch`', async () => {
    const url = `http://127.0.0.1:${closedPort}/`
    const err = await captureError(() => fetch(url))
    expect(classifyNetworkError(err)).toMatchObject({ kind: 'refused', code: 'ECONNREFUSED' })
    expect(clean(describeNetworkError(err, url))).toBe(`Connection to 127.0.0.1:${closedPort} was refused.`)
  })

  it('describes a real refused connection from `ofetch`', async () => {
    const url = `http://127.0.0.1:${closedPort}/`
    const err = await captureError(() => $fetch(url))
    expect(classifyNetworkError(err).kind).toBe('refused')
    expect(clean(describeNetworkError(err, url))).toBe(`Connection to 127.0.0.1:${closedPort} was refused.`)
  })

  it('describes a real `ofetch` non-2xx response', async () => {
    const url = `http://127.0.0.1:${port}/teapot`
    const err = await captureError(() => $fetch(url))
    expect(classifyNetworkError(err)).toMatchObject({ kind: 'http', status: 418 })
    expect(clean(describeNetworkError(err, url))).toBe(`Request to 127.0.0.1:${port} failed with status 418.`)
  })

  it('describes a real `ofetch` timeout, whose code is a DOMException number', async () => {
    const url = `http://127.0.0.1:${port}/slow`
    const err = await captureError(() => $fetch(url, { timeout: 20 }))
    expect(classifyNetworkError(err).kind).toBe('timeout')
    expect(clean(describeNetworkError(err, url))).toBe(`Connection to 127.0.0.1:${port} timed out.`)
  })

  it('collapses a real `giget` failure, which preserves neither cause nor code', async () => {
    const url = `http://127.0.0.1:${closedPort}/templates`
    const err = await captureError(() => downloadTemplate('minimal', { dir: '/tmp/nuxi-network-spec', registry: url, force: true }))

    expect((err as Error).cause).toBeUndefined()
    expect(classifyNetworkError(err).kind).toBe('unknown')
    expect(clean(describeNetworkError(err, url))).toBe(`Could not reach 127.0.0.1:${closedPort}.`)
  })

  it('recovers a diagnosable error for an unreachable origin', async () => {
    const probed = await probeNetworkError(`http://127.0.0.1:${closedPort}/templates`)
    expect(classifyNetworkError(probed)).toMatchObject({ kind: 'refused', code: 'ECONNREFUSED' })
    expect(clean(describeNetworkError(probed, `http://127.0.0.1:${closedPort}/templates`)))
      .toBe(`Connection to 127.0.0.1:${closedPort} was refused.`)
  })

  it('does not invent a failure when the origin is reachable', async () => {
    await expect(probeNetworkError(`http://127.0.0.1:${port}/templates`)).resolves.toBeUndefined()
    await expect(probeNetworkError('not a url')).resolves.toBeUndefined()
  })
})

describe('describeNetworkError', () => {
  it('names the unreachable host', () => {
    expect(clean(describeNetworkError(withCode('ENOTFOUND'), 'https://api.github.com/repos')))
      .toBe('Could not resolve api.github.com (DNS lookup failed).')
  })

  it('distinguishes DNS, refused, timeout and TLS failures', () => {
    const url = 'https://registry.npmjs.org/nuxt'
    expect(clean(describeNetworkError(withCode('EAI_AGAIN'), url))).toContain('DNS lookup for registry.npmjs.org timed out')
    expect(clean(describeNetworkError(withCode('ECONNREFUSED'), url))).toContain('was refused')
    expect(clean(describeNetworkError(withCode('UND_ERR_CONNECT_TIMEOUT'), url))).toContain('timed out')
    expect(clean(describeNetworkError(withCode('CERT_HAS_EXPIRED'), url))).toContain('TLS connection')
  })

  it('reports non-2xx responses', () => {
    const err = Object.assign(new Error('404 Not Found'), { response: { status: 404 }, statusCode: 404 })
    expect(clean(describeNetworkError(err, 'https://api.nuxt.com/modules')))
      .toBe('Request to api.nuxt.com failed with status 404.')
  })

  it('calls out proxy authentication failures', () => {
    const err = Object.assign(new Error('407'), { statusCode: 407 })
    expect(classifyNetworkError(err).kind).toBe('proxy-auth')
    expect(clean(describeNetworkError(err, 'https://registry.npmjs.org/nuxt')))
      .toContain('proxy authentication required')
  })

  it('reports aborted requests as timeouts', () => {
    const err = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    expect(clean(describeNetworkError(err, 'https://api.nuxt.com/modules'))).toContain('timed out')
  })

  it('recognises codes that were stringified into the message', () => {
    const err = new Error('Failed to download https://registry.example.com/minimal.json: TypeError: fetch failed (ENOTFOUND)')
    expect(clean(describeNetworkError(err, 'https://registry.example.com/templates')))
      .toBe('Could not resolve registry.example.com (DNS lookup failed).')
  })

  it('collapses opaque `fetch failed` chains', () => {
    const err = new Error('Failed to download template from registry: Failed to download https://example.com/minimal.json: TypeError: fetch failed')
    expect(clean(describeNetworkError(err, 'https://example.com/templates'))).toBe('Could not reach example.com.')
  })

  it('falls back to the original message', () => {
    expect(clean(describeNetworkError(new Error('socket hang up'), 'https://example.com')))
      .toBe('Could not reach example.com: socket hang up')
    expect(clean(describeNetworkError('boom'))).toBe('Could not reach the network: boom')
  })
})

describe('formatRetryCommand', () => {
  it('rebuilds the invocation with an environment prefix', () => {
    expect(formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, { argv: NUXI_ARGV, env: {}, windows: false }))
      .toBe('NODE_USE_ENV_PROXY=1 nuxt init "my app"')
  })

  it('uses PowerShell or cmd syntax on Windows', () => {
    expect(formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, { argv: NUXI_ARGV, env: { PSModulePath: 'C:\\ps' }, windows: true }))
      .toBe('$env:NODE_USE_ENV_PROXY="1"; nuxt init "my app"')
    expect(formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, { argv: NUXI_ARGV, env: {}, windows: true }))
      .toBe('set NODE_USE_ENV_PROXY=1 && nuxt init "my app"')
  })

  it('falls back to an assignment when the invocation is indirect', () => {
    const argv = ['/usr/bin/node', '/tmp/.npm/_npx/abc/node_modules/create-nuxt/dist/index.mjs', 'my-app']
    expect(formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, { argv, env: {}, windows: false }))
      .toBe('export NODE_USE_ENV_PROXY=1')
    expect(formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, { argv, env: {}, windows: true }))
      .toBe('set NODE_USE_ENV_PROXY=1')
  })
})

describe('getProxyHint', () => {
  it('suggests proxy variables when none are set, without a retry command', () => {
    const hint = clean(getProxyHint('dns', { argv: NUXI_ARGV, env: {}, windows: false })!)
    expect(hint).toContain('HTTPS_PROXY')
    expect(hint).not.toContain('nuxt init')
  })

  it('points out when a configured proxy is not in use', () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128' }
    setupProxySupport({ ...env })
    const hint = clean(getProxyHint('dns', { argv: NUXI_ARGV, env, windows: false })!)
    expect(hint).toContain(supportsEnvProxy() ? 'NODE_USE_ENV_PROXY=1 nuxt init "my app"' : 'cannot use it')
  })

  it('stays quiet when the proxy is already in use', () => {
    if (!supportsEnvProxy()) {
      return
    }
    const env = { HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' }
    setupProxySupport({ ...env })
    expect(getProxyHint('dns', { env })).toBeUndefined()
  })

  it('suggests a root certificate for intercepted TLS', () => {
    const hint = clean(getProxyHint('tls', { argv: NUXI_ARGV, env: {}, windows: false })!)
    expect(hint).toContain('NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem nuxt init "my app"')
  })

  it('suggests credentials for a 407', () => {
    expect(clean(getProxyHint('proxy-auth', { env: {} })!)).toContain('user:password@proxy.example.com')
  })

  it('does not blame the proxy for a plain HTTP error', () => {
    expect(getProxyHint('http', { env: {} })).toBeUndefined()
  })

  it('suspects TLS interception when a proxy in use resets the connection', () => {
    if (!supportsEnvProxy()) {
      return
    }
    const env = { HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' }
    setupProxySupport({ ...env })
    const hint = clean(getProxyHint('reset', { argv: NUXI_ARGV, env, windows: false })!)
    expect(hint).toContain('re-signing TLS traffic')
    expect(hint).toContain('NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem nuxt init "my app"')
  })

  it('prefers the proxy-not-in-use hint over the certificate hint', () => {
    if (!supportsEnvProxy()) {
      return
    }
    const env = { HTTPS_PROXY: 'http://localhost:3128' }
    setupProxySupport({ ...env })
    expect(clean(getProxyHint('reset', { argv: NUXI_ARGV, env, windows: false })!))
      .toContain('NODE_USE_ENV_PROXY=1')
  })
})

describe('logNetworkError', () => {
  beforeEach(() => {
    logs.length = 0
  })

  it('logs one error line and one hint line', () => {
    logNetworkError(withCode('ENOTFOUND'), {
      url: 'https://raw.githubusercontent.com/nuxt/starter',
      hints: ['Retry with --offline.'],
    })

    expect(logs.filter(([level]) => level === 'error')).toHaveLength(1)
    expect(logs.filter(([level]) => level === 'info')).toHaveLength(1)
    expect(clean(logs[0]![1])).toContain('raw.githubusercontent.com')
    expect(clean(logs[1]![1])).toContain('Retry with --offline.')
  })

  it('prefixes the description when asked', () => {
    logNetworkError(withCode('ECONNRESET'), { url: 'https://registry.npmjs.org/nuxt', prefix: 'Failed to fetch package details.' })
    expect(clean(logs[0]![1])).toContain('Failed to fetch package details. Connection to registry.npmjs.org')
  })
})
