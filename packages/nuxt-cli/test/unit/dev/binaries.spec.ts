import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCacheDir, resolveTool } from '../../../src/dev/binaries'
import { resolveCloudflaredVersion } from '../../../src/dev/tunnel'

let cacheHome: string
const originalCacheHome = process.env.XDG_CACHE_HOME

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), 'nuxt-binaries-'))
  process.env.XDG_CACHE_HOME = cacheHome
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cacheHome, { recursive: true, force: true })
  if (originalCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME
  }
  else {
    process.env.XDG_CACHE_HOME = originalCacheHome
  }
})

describe('resolveCloudflaredVersion', () => {
  it('should fall back to the pinned version when the override is unset', () => {
    expect(resolveCloudflaredVersion(undefined)).toMatch(/^\d/)
    expect(resolveCloudflaredVersion('')).toBe(resolveCloudflaredVersion(undefined))
  })

  it('should accept a plain version or dist tag', () => {
    expect(resolveCloudflaredVersion('2026.7.3')).toBe('2026.7.3')
    expect(resolveCloudflaredVersion('latest')).toBe('latest')
  })

  it('should reject a version that could traverse the release url or the cache', () => {
    const pinned = resolveCloudflaredVersion(undefined)
    expect(resolveCloudflaredVersion('../../../../tmp/evil')).toBe(pinned)
    expect(resolveCloudflaredVersion('2026.7.3/../..')).toBe(pinned)
    expect(resolveCloudflaredVersion('a b')).toBe(pinned)
  })
})

describe('resolveTool', () => {
  it('should refuse a cache name that escapes the cache directory', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveTool('nuxt-tool-that-does-not-exist', {
      url: 'https://example.com/cloudflared',
      cacheName: '../../escaped',
      consent: { key: 'nuxt-tool-that-does-not-exist', notice: [], message: '', nonInteractiveWarning: '' },
    })).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('getCacheDir', () => {
  it('should create the directory under XDG_CACHE_HOME', () => {
    expect(getCacheDir('bin')).toBe(join(cacheHome, 'nuxt', 'bin'))
  })
})
