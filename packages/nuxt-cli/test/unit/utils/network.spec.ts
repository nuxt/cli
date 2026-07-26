import type { Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { downloadTemplate } from 'giget'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const { fetchJson } = await import('../../../src/utils/fetch')

const NUXI_ARGV = ['/usr/bin/node', '/project/node_modules/.bin/nuxi.mjs', 'init', 'my app']

/** Stand in for the flags Node.js accepts, so tests do not depend on the runtime. */
const MODERN_NODE = new Set(['--use-env-proxy'])
const OLD_NODE = new Set<string>()

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
    expect(setupProxySupport(env, MODERN_NODE)).toBe('children-only')
    expect(env.NODE_USE_ENV_PROXY).toBe('1')
  })

  it('reports Node.js versions that cannot use the proxy', () => {
    const env = { HTTP_PROXY: 'http://localhost:3128' } as NodeJS.ProcessEnv
    expect(setupProxySupport(env, OLD_NODE)).toBe('unsupported')
    expect(env.NODE_USE_ENV_PROXY).toBeUndefined()
  })

  it('detects support from the flags Node.js accepts', () => {
    expect(supportsEnvProxy(new Set(['--use-env-proxy']))).toBe(true)
    expect(supportsEnvProxy(new Set(['--enable-source-maps']))).toBe(false)
    expect(supportsEnvProxy({ has: () => false })).toBe(false)
  })

  it('reports the current process as proxy-aware when launched with the flag', () => {
    expect(isEnvProxyActive({ NODE_USE_ENV_PROXY: '1' }, [], MODERN_NODE)).toBe(true)
    expect(isEnvProxyActive({ NODE_OPTIONS: '--use-env-proxy' }, [], MODERN_NODE)).toBe(true)
    expect(isEnvProxyActive({ NODE_OPTIONS: '--max-old-space-size=4096 --use-env-proxy' }, [], MODERN_NODE)).toBe(true)
    expect(isEnvProxyActive({ NODE_OPTIONS: '--require=/tmp/--use-env-proxy.js' }, [], MODERN_NODE)).toBe(false)
    expect(isEnvProxyActive({}, ['--use-env-proxy'], MODERN_NODE)).toBe(true)
    expect(isEnvProxyActive({ HTTPS_PROXY: 'http://localhost:3128' }, [], MODERN_NODE)).toBe(false)
    expect(isEnvProxyActive({ NODE_USE_ENV_PROXY: '1' }, [], OLD_NODE)).toBe(false)
    expect(setupProxySupport({ HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' }, MODERN_NODE)).toBe('active')
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

  it('describes a real refused connection from `fetchJson`', async () => {
    const url = `http://127.0.0.1:${closedPort}/`
    const err = await captureError(() => fetchJson(url))
    expect(classifyNetworkError(err).kind).toBe('refused')
    expect(clean(describeNetworkError(err, url))).toBe(`Connection to 127.0.0.1:${closedPort} was refused.`)
  })

  it('describes a real `fetchJson` non-2xx response', async () => {
    const url = `http://127.0.0.1:${port}/teapot`
    const err = await captureError(() => fetchJson(url))
    expect(classifyNetworkError(err)).toMatchObject({ kind: 'http', status: 418 })
    expect(clean(describeNetworkError(err, url))).toBe(`Request to 127.0.0.1:${port} failed with status 418.`)
  })

  it('describes a real `fetchJson` timeout, whose code is a DOMException number', async () => {
    const url = `http://127.0.0.1:${port}/slow`
    const err = await captureError(() => fetchJson(url, { timeout: 20 }))
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

  it('describes a real TLS handshake against a plain HTTP server', async () => {
    const url = `https://127.0.0.1:${port}/`
    const err = await captureError(() => fetch(url))
    expect(classifyNetworkError(err).kind).toBe('tls')
    expect(clean(describeNetworkError(err, url))).toMatch(/^TLS connection to 127\.0\.0\.1:\d+ could not be verified \(ERR_SSL_/)
  })
})

/** Certificate fixtures need `openssl`, which not every machine has. */
const hasOpenSSL = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
})()

describe.skipIf(!hasOpenSSL)('describeNetworkError with an untrusted certificate', () => {
  let url = ''
  let server: HttpsServer | undefined
  let dir = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-network-tls-'))
    const key = join(dir, 'key.pem')
    const cert = join(dir, 'cert.pem')
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' })

    server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (_req, res) => res.end('{}'))
    const port = await new Promise<number>(resolve => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)))
    url = `https://127.0.0.1:${port}/`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve())
    await rm(dir, { recursive: true, force: true })
  })

  it('flags a self-signed certificate as a TLS failure', async () => {
    const err = await captureError(() => fetch(url))
    expect(classifyNetworkError(err)).toMatchObject({ kind: 'tls', code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    expect(clean(describeNetworkError(err, url)))
      .toMatch(/^TLS connection to 127\.0\.0\.1:\d+ could not be verified \(DEPTH_ZERO_SELF_SIGNED_CERT\)\.$/)
  })

  it('advises a root certificate for a self-signed chain, whatever the proxy state', async () => {
    const err = await captureError(() => fetch(url))
    const hint = clean(getProxyHint(classifyNetworkError(err).kind, { argv: NUXI_ARGV, env: {}, windows: false, flags: MODERN_NODE })!)
    expect(hint).toContain('NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem')
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
    const hint = clean(getProxyHint('dns', { argv: NUXI_ARGV, env, windows: false, flags: MODERN_NODE })!)
    expect(hint).toContain('NODE_USE_ENV_PROXY=1 nuxt init "my app"')
  })

  it('asks for a Node.js upgrade when the flag is unavailable', () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128' }
    const hint = clean(getProxyHint('dns', { argv: NUXI_ARGV, env, windows: false, flags: OLD_NODE })!)
    expect(hint).toContain('cannot use it')
    expect(hint).toContain('Node.js 24 (or 22.18+)')
    expect(hint).not.toContain('Retry with')
  })

  it('stays quiet when the proxy is already in use', () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' }
    expect(getProxyHint('dns', { env, flags: MODERN_NODE })).toBeUndefined()
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
    const env = { HTTPS_PROXY: 'http://localhost:3128', NODE_USE_ENV_PROXY: '1' }
    const hint = clean(getProxyHint('reset', { argv: NUXI_ARGV, env, windows: false, flags: MODERN_NODE })!)
    expect(hint).toContain('re-signing TLS traffic')
    expect(hint).toContain('NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem nuxt init "my app"')
  })

  it('prefers the proxy-not-in-use hint over the certificate hint', () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128' }
    expect(clean(getProxyHint('reset', { argv: NUXI_ARGV, env, windows: false, flags: MODERN_NODE })!))
      .toContain('NODE_USE_ENV_PROXY=1')
  })
})

describe('logNetworkError', () => {
  beforeEach(() => {
    logs.length = 0

    // Pin a proxy that the process is not using, so a hint is always produced
    // regardless of the environment the suite runs in.
    vi.stubEnv('HTTPS_PROXY', 'http://localhost:3128')
    vi.stubEnv('NODE_OPTIONS', '')
    vi.stubEnv('NODE_USE_ENV_PROXY', undefined)
    setupProxySupport({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('warns instead of erroring where the command carries on', () => {
    logNetworkError(withCode('ENOTFOUND'), { url: 'https://api.nuxt.com/modules', level: 'warn' })
    expect(logs[0]![0]).toBe('warn')
  })

  it('repeats the proxy advice only once per process', () => {
    const options = { url: 'https://api.nuxt.com/modules' }
    logNetworkError(withCode('ENOTFOUND'), options)
    logNetworkError(withCode('ENOTFOUND'), options)

    const hints = logs.filter(([level]) => level === 'info')
    expect(hints).toHaveLength(1)
    expect(logs.filter(([level]) => level === 'error')).toHaveLength(2)
  })

  it('still shows caller hints after the proxy advice is spent', () => {
    logNetworkError(withCode('ENOTFOUND'), { url: 'https://api.nuxt.com/modules' })
    logs.length = 0

    logNetworkError(withCode('ENOTFOUND'), { url: 'https://api.nuxt.com/modules', hints: ['Retry with --offline.'] })
    expect(clean(logs[1]![1])).toBe('Retry with --offline.')
  })
})
