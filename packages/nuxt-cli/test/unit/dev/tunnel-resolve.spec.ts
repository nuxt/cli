import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'

const select = vi.fn()
const isInteractive = vi.fn(() => false)
/** clack's own cancel symbol is private, so the mock recognises this one too. */
const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clack/prompts')>()
  return {
    ...original,
    select: (...args: unknown[]) => select(...args),
    isCancel: (value: unknown) => value === CANCEL || original.isCancel(value),
  }
})
const ensureOpenTunnelSDK = vi.fn(async (_rootDir: string) => true)
vi.mock('../../../src/dev/tunnel/opentunnel-install', () => ({ ensureOpenTunnelSDK }))
vi.mock('../../../src/utils/stdout', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/stdout')>(),
  isInteractive: () => isInteractive(),
}))

const { deriveRouteName, parseTunnelProvider, resolveTunnelOptions } = await import('../../../src/dev/tunnel/resolve')

const ROUTE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

let home: string

function readNuxtRC(): string {
  try {
    return readFileSync(join(home, '.nuxtrc'), 'utf8')
  }
  catch {
    return ''
  }
}

beforeEach(() => {
  // `rc9` prefers `XDG_CONFIG_HOME` (set on some CI images), then the home directory.
  home = mkdtempSync(join(tmpdir(), 'nuxt-tunnel-home-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('XDG_CONFIG_HOME', home)
  isInteractive.mockReturnValue(false)
  ensureOpenTunnelSDK.mockClear()
  ensureOpenTunnelSDK.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  select.mockReset()
  rmSync(home, { recursive: true, force: true })
})

describe('parseTunnelProvider', () => {
  it('should accept each provider, and `cloudflared` as an alias', () => {
    expect(parseTunnelProvider('cloudflare')).toBe('cloudflare')
    expect(parseTunnelProvider('cloudflared')).toBe('cloudflare')
    expect(parseTunnelProvider('opentunnel')).toBe('opentunnel')
  })

  it('should reject anything else', () => {
    for (const value of [undefined, '', 'ngrok', true, 1]) {
      expect(parseTunnelProvider(value), String(value)).toBeUndefined()
    }
  })
})

describe('deriveRouteName', () => {
  const seed = 'a'.repeat(32)

  it('should be stable for a project', () => {
    expect(deriveRouteName(seed, '/projects/app')).toBe(deriveRouteName(seed, '/projects/app/'))
  })

  it('should differ between projects and between seeds', () => {
    expect(deriveRouteName(seed, '/projects/app')).not.toBe(deriveRouteName(seed, '/projects/other'))
    expect(deriveRouteName(seed, '/projects/app')).not.toBe(deriveRouteName('b'.repeat(32), '/projects/app'))
  })

  it('should be a 16-character DNS label, as OpenTunnel routes must be', () => {
    const route = deriveRouteName(seed, '/projects/my.app')
    expect(route).toHaveLength(16)
    expect(route).toMatch(ROUTE_LABEL_RE)
  })
})

describe('resolveTunnelOptions', () => {
  it('should start no tunnel when the flag is absent or negated', async () => {
    await expect(resolveTunnelOptions(undefined, '/app')).resolves.toBeUndefined()
    await expect(resolveTunnelOptions(false, '/app')).resolves.toBeUndefined()
  })

  it('should use an explicit provider', async () => {
    await expect(resolveTunnelOptions('cloudflare', '/app')).resolves.toEqual({ provider: 'cloudflare' })
    await expect(resolveTunnelOptions('opentunnel', '/app')).resolves.toMatchObject({ provider: 'opentunnel', route: expect.stringMatching(ROUTE_LABEL_RE) })
    expect(select).not.toHaveBeenCalled()
  })

  it('should make sure the project has the OpenTunnel SDK, and start no tunnel without it', async () => {
    await expect(resolveTunnelOptions('opentunnel', '/app')).resolves.toMatchObject({ provider: 'opentunnel', rootDir: '/app' })
    expect(ensureOpenTunnelSDK).toHaveBeenCalledWith('/app')

    ensureOpenTunnelSDK.mockResolvedValue(false)
    await expect(resolveTunnelOptions('opentunnel', '/app')).resolves.toBeUndefined()
  })

  it('should not touch the OpenTunnel SDK for a Cloudflare tunnel', async () => {
    await resolveTunnelOptions('cloudflare', '/app')
    expect(ensureOpenTunnelSDK).not.toHaveBeenCalled()
  })

  it('should warn about an unknown provider and use Cloudflare', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await expect(resolveTunnelOptions('./app', '/app')).resolves.toEqual({ provider: 'cloudflare' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown tunnel provider `./app`'))
  })

  it('should keep the OpenTunnel route between runs by saving a seed once', async () => {
    const first = await resolveTunnelOptions('opentunnel', '/app')
    const rc = readNuxtRC()
    expect(rc).toMatch(/^tools\.opentunnel\.seed="[0-9a-f]{32}"$/m)

    await expect(resolveTunnelOptions('opentunnel', '/app')).resolves.toEqual(first)
    expect(readNuxtRC()).toBe(rc)
  })

  it('should use the saved provider for a bare --tunnel', async () => {
    writeFileSync(join(home, '.nuxtrc'), 'tools.tunnel.provider="opentunnel"\n')
    await expect(resolveTunnelOptions('', '/app')).resolves.toMatchObject({ provider: 'opentunnel' })
    expect(select).not.toHaveBeenCalled()
  })

  it('should use Cloudflare without asking or saving when nobody can answer', async () => {
    await expect(resolveTunnelOptions('', '/app')).resolves.toEqual({ provider: 'cloudflare' })
    expect(select).not.toHaveBeenCalled()
    expect(readNuxtRC()).not.toContain('tools.tunnel.provider')
  })

  it('should ask once for a bare --tunnel and remember the answer', async () => {
    isInteractive.mockReturnValue(true)
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    select.mockResolvedValue('opentunnel')

    await expect(resolveTunnelOptions('', '/app')).resolves.toMatchObject({ provider: 'opentunnel' })
    expect(select).toHaveBeenCalledTimes(1)
    expect(readNuxtRC()).toContain('tools.tunnel.provider="opentunnel"')

    await expect(resolveTunnelOptions(true, '/app')).resolves.toMatchObject({ provider: 'opentunnel' })
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('should start no tunnel and save nothing when the prompt is cancelled', async () => {
    isInteractive.mockReturnValue(true)
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    select.mockResolvedValue(CANCEL)

    await expect(resolveTunnelOptions('', '/app')).resolves.toBeUndefined()
    expect(readNuxtRC()).not.toContain('tools.tunnel.provider')
  })
})
