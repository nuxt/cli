import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findLockFile, parseInstallSpec, resolveCatalogSpecifier } from '../../../src/commands/upgrade'
import { resolveRegistryVersion } from '../../../src/utils/versions'

vi.mock('../../../src/utils/versions', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/versions')>(),
  resolveRegistryVersion: vi.fn(),
}))

describe('findLockFile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-upgrade-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should find a lock file in the current directory', async () => {
    await writeFile(join(tempDir, 'package-lock.json'), '{}')

    expect(findLockFile(tempDir, tempDir, 'package-lock.json')).toBe('package-lock.json')
  })

  it('should find a lock file in a nested app directory when the workspace root has none', async () => {
    const appDir = join(tempDir, 'fe')
    await mkdir(appDir)
    await writeFile(join(appDir, 'package-lock.json'), '{}')

    expect(findLockFile(appDir, tempDir, ['package-lock.json'])).toBe('package-lock.json')
  })

  it('should find a lock file in the workspace root', async () => {
    const appDir = join(tempDir, 'packages', 'app')
    await mkdir(appDir, { recursive: true })
    await writeFile(join(tempDir, 'pnpm-lock.yaml'), '')

    expect(findLockFile(appDir, tempDir, 'pnpm-lock.yaml')).toBe('../../pnpm-lock.yaml')
  })

  it('should prefer the closest lock file', async () => {
    const appDir = join(tempDir, 'fe')
    await mkdir(appDir)
    await writeFile(join(tempDir, 'package-lock.json'), '{}')
    await writeFile(join(appDir, 'package-lock.json'), '{}')

    expect(findLockFile(appDir, tempDir, 'package-lock.json')).toBe('package-lock.json')
  })

  it('should not look above the workspace root', async () => {
    const appDir = join(tempDir, 'fe')
    await mkdir(appDir)
    await writeFile(join(tempDir, 'package-lock.json'), '{}')

    expect(findLockFile(appDir, appDir, 'package-lock.json')).toBeUndefined()
  })

  it('should return undefined when there is no lock file', () => {
    expect(findLockFile(tempDir, tempDir, ['package-lock.json', 'pnpm-lock.yaml'])).toBeUndefined()
    expect(findLockFile(tempDir, tempDir, undefined)).toBeUndefined()
  })
})

describe('parseInstallSpec', () => {
  it('should split a package from its dist-tag', () => {
    expect(parseInstallSpec('nuxt@latest')).toEqual({ name: 'nuxt', target: 'nuxt', range: 'latest', aliased: false })
  })

  it('should default to the latest dist-tag for a bare package name', () => {
    expect(parseInstallSpec('nuxt')).toEqual({ name: 'nuxt', target: 'nuxt', range: 'latest', aliased: false })
    expect(parseInstallSpec('@nuxt/kit')).toEqual({ name: '@nuxt/kit', target: '@nuxt/kit', range: 'latest', aliased: false })
  })

  it('should split a scoped package from its range', () => {
    expect(parseInstallSpec('@nuxt/kit@3')).toEqual({ name: '@nuxt/kit', target: '@nuxt/kit', range: '3', aliased: false })
  })

  it('should resolve an aliased nightly install through the aliased package', () => {
    expect(parseInstallSpec('nuxt@npm:nuxt-nightly@latest')).toEqual({
      name: 'nuxt',
      target: 'nuxt-nightly',
      range: 'latest',
      aliased: true,
    })
  })

  it('should resolve an aliased nightly install of a scoped package', () => {
    expect(parseInstallSpec('@nuxt/kit@npm:@nuxt/kit-nightly@3x')).toEqual({
      name: '@nuxt/kit',
      target: '@nuxt/kit-nightly',
      range: '3x',
      aliased: true,
    })
  })
})

describe('resolveCatalogSpecifier', () => {
  it('should write a caret range for a regular package', async () => {
    vi.mocked(resolveRegistryVersion).mockResolvedValue('4.2.1')

    expect(await resolveCatalogSpecifier({ name: 'nuxt', target: 'nuxt', range: 'latest', aliased: false })).toBe('^4.2.1')
    expect(vi.mocked(resolveRegistryVersion)).toHaveBeenCalledWith('nuxt', 'latest')
  })

  it('should write an npm alias for an aliased package', async () => {
    vi.mocked(resolveRegistryVersion).mockResolvedValue('4.3.0-28991214-abcdef')

    expect(await resolveCatalogSpecifier({ name: 'nuxt', target: 'nuxt-nightly', range: 'latest', aliased: true })).toBe('npm:nuxt-nightly@^4.3.0-28991214-abcdef')
  })

  it('should keep the range operator of the entry it replaces', async () => {
    vi.mocked(resolveRegistryVersion).mockResolvedValue('4.2.1')
    const spec = { name: 'nuxt', target: 'nuxt', range: 'latest', aliased: false }

    expect(await resolveCatalogSpecifier(spec, '4.1.0')).toBe('4.2.1')
    expect(await resolveCatalogSpecifier(spec, '~4.1.0')).toBe('~4.2.1')
    expect(await resolveCatalogSpecifier(spec, '^4.1.0')).toBe('^4.2.1')
    expect(await resolveCatalogSpecifier(spec, '>=4.0.0')).toBe('^4.2.1')
  })

  it('should keep the range operator of an aliased entry', async () => {
    vi.mocked(resolveRegistryVersion).mockResolvedValue('4.3.0-28991214-abcdef')
    const spec = { name: 'nuxt', target: 'nuxt-nightly', range: 'latest', aliased: true }

    expect(await resolveCatalogSpecifier(spec, 'npm:nuxt-nightly@4.2.0-28991213-abcdef')).toBe('npm:nuxt-nightly@4.3.0-28991214-abcdef')
    expect(await resolveCatalogSpecifier(spec, 'npm:nuxt-nightly@^4.2.0')).toBe('npm:nuxt-nightly@^4.3.0-28991214-abcdef')
  })

  it('should return nothing when no version matches', async () => {
    vi.mocked(resolveRegistryVersion).mockResolvedValue(undefined)

    expect(await resolveCatalogSpecifier({ name: 'nuxt', target: 'nuxt', range: '99', aliased: false })).toBeUndefined()
  })
})
