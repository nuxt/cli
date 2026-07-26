import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findPnpmWorkspaceYaml, parseCatalogSpecifier, readCatalogConfig, resolveCatalogEntry } from '../../../src/utils/catalog'

describe('parseCatalogSpecifier', () => {
  it('should treat a bare `catalog:` as the default catalog', () => {
    expect(parseCatalogSpecifier('catalog:')).toBe('default')
  })

  it('should read the name from a named catalog reference', () => {
    expect(parseCatalogSpecifier('catalog:prod')).toBe('prod')
  })

  it('should ignore specifiers that are not catalog references', () => {
    expect(parseCatalogSpecifier('^4.2.0')).toBeUndefined()
    expect(parseCatalogSpecifier('workspace:*')).toBeUndefined()
    expect(parseCatalogSpecifier('npm:nuxt-nightly@latest')).toBeUndefined()
    expect(parseCatalogSpecifier(undefined)).toBeUndefined()
  })
})

describe('catalog resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-catalog-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should find the workspace file from a nested package', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.2.0\n')
    const appDir = join(tempDir, 'packages', 'app')
    await mkdir(appDir, { recursive: true })

    expect(findPnpmWorkspaceYaml(appDir)).toBe(join(tempDir, 'pnpm-workspace.yaml'))
  })

  it('should expose the default and named catalogs together', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), [
      'catalog:',
      '  nuxt: ^4.2.0',
      'catalogs:',
      '  dev:',
      '    typescript: ^5.9.0',
    ].join('\n'))

    expect(readCatalogConfig(tempDir)?.catalogs).toEqual({
      default: { nuxt: '^4.2.0' },
      dev: { typescript: '^5.9.0' },
    })
  })

  it('should return no config when the workspace declares no catalogs', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')

    expect(readCatalogConfig(tempDir)).toBeUndefined()
  })

  it('should resolve a dependency declared with a bare catalog reference', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.2.0\n')

    expect(resolveCatalogEntry(tempDir, { dependencies: { nuxt: 'catalog:' } }, 'nuxt')).toEqual({
      catalog: 'default',
      specifier: '^4.2.0',
    })
  })

  it('should resolve a dev dependency declared with a named catalog reference', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalogs:\n  prod:\n    nuxt: 4.2.0\n')

    expect(resolveCatalogEntry(tempDir, { devDependencies: { nuxt: 'catalog:prod' } }, 'nuxt')).toEqual({
      catalog: 'prod',
      specifier: '4.2.0',
    })
  })

  it('should resolve a specifier defined through a yaml anchor', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), [
      'catalogs:',
      '  prod:',
      '    nuxt: &nuxt ^4.2.0',
      '  legacy:',
      '    nuxt: *nuxt',
    ].join('\n'))

    expect(resolveCatalogEntry(tempDir, { dependencies: { nuxt: 'catalog:legacy' } }, 'nuxt')?.specifier).toBe('^4.2.0')
  })

  it('should report the catalog without a specifier when the entry is missing', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  vue: ^3.6.0\n')

    expect(resolveCatalogEntry(tempDir, { dependencies: { nuxt: 'catalog:' } }, 'nuxt')).toEqual({
      catalog: 'default',
      specifier: undefined,
    })
  })

  it('should ignore dependencies that are not catalog-managed', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.2.0\n')

    expect(resolveCatalogEntry(tempDir, { dependencies: { nuxt: '^4.1.0' } }, 'nuxt')).toBeUndefined()
    expect(resolveCatalogEntry(tempDir, {}, 'nuxt')).toBeUndefined()
    expect(resolveCatalogEntry(tempDir, null, 'nuxt')).toBeUndefined()
  })
})
