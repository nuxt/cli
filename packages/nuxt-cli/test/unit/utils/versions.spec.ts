import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchJson } from '../../../src/utils/fetch'
import { detectNpmRegistry } from '../../../src/utils/registry'
import { getNuxtVersion, resolveRegistryVersion } from '../../../src/utils/versions'

vi.mock('../../../src/utils/fetch', () => ({ fetchJson: vi.fn() }))
vi.mock('../../../src/utils/registry', () => ({ detectNpmRegistry: vi.fn() }))

describe('getNuxtVersion', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-versions-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should read the declared version when nuxt is not installed', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ devDependencies: { nuxt: '^4.2.0' } }))

    expect(await getNuxtVersion(tempDir, false)).toBe('4.2.0')
  })

  it('should resolve a catalog reference through pnpm-workspace.yaml', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ devDependencies: { nuxt: 'catalog:' } }))
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.2.0\n')

    expect(await getNuxtVersion(tempDir, false)).toBe('4.2.0')
  })

  it('should resolve a named catalog reference', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ dependencies: { nuxt: 'catalog:prod' } }))
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalogs:\n  prod:\n    nuxt: 4.1.2\n')

    expect(await getNuxtVersion(tempDir, false)).toBe('4.1.2')
  })

  it('should fall back when the catalog has no entry for nuxt', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ dependencies: { nuxt: 'catalog:' } }))
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  vue: ^3.6.0\n')

    expect(await getNuxtVersion(tempDir, false)).toBe('3.0.0')
  })
})

describe('resolveRegistryVersion', () => {
  beforeEach(() => {
    vi.mocked(detectNpmRegistry).mockResolvedValue({ registry: 'https://registry.example.com/', authToken: null })
  })

  it('should prefer a matching dist-tag', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ 'dist-tags': { latest: '4.2.0' }, 'versions': { '4.2.0': {}, '5.0.0-rc.1': {} } })

    expect(await resolveRegistryVersion('nuxt', 'latest')).toBe('4.2.0')
  })

  it('should pick the highest matching version regardless of publication order', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ 'dist-tags': { latest: '4.2.0' }, 'versions': { '3.17.0': {}, '3.19.0': {}, '3.18.1': {} } })

    expect(await resolveRegistryVersion('nuxt', '3')).toBe('3.19.0')
  })

  it('should return nothing when no version matches', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ 'dist-tags': { latest: '4.2.0' }, 'versions': { '4.2.0': {} } })

    expect(await resolveRegistryVersion('nuxt', '99')).toBeUndefined()
  })

  it('should return nothing when the registry cannot be reached', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await resolveRegistryVersion('nuxt', 'latest')).toBeUndefined()
  })
})
