import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearCatalogCache, findPnpmWorkspaceYaml, parseCatalogSpecifier, readCatalogConfig, resolveCatalogEntry, updateCatalogEntries } from '../../../src/utils/catalog'

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
    clearCatalogCache()
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

describe('updateCatalogEntries', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-catalog-test-'))
    clearCatalogCache()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should update an entry while preserving comments', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, '# pinned by policy\ncatalog:\n  nuxt: ^4.1.0\n  vue: ^3.6.0\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('# pinned by policy\ncatalog:\n  nuxt: ^4.2.0\n  vue: ^3.6.0\n')
  })

  it('should update entries across catalogs in a single write', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'catalog:\n  nuxt: ^4.1.0\ncatalogs:\n  prod:\n    "@nuxt/kit": ^4.1.0\n')

    expect(updateCatalogEntries(tempDir, [
      { catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' },
      { catalog: 'prod', pkg: '@nuxt/kit', specifier: '^4.2.0' },
    ])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('catalog:\n  nuxt: ^4.2.0\ncatalogs:\n  prod:\n    "@nuxt/kit": ^4.2.0\n')
  })

  it('should update an entry in a named catalog', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'catalogs:\n  prod:\n    nuxt: ^4.1.0\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'prod', pkg: 'nuxt', specifier: 'npm:nuxt-nightly@^4.3.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('catalogs:\n  prod:\n    nuxt: npm:nuxt-nightly@^4.3.0\n')
  })

  it('should report entries that already match as unchanged', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.2.0\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('unchanged')
  })

  it('should invalidate cached catalog config after a write', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: ^4.1.0\n')

    expect(readCatalogConfig(tempDir)?.catalogs.default).toEqual({ nuxt: '^4.1.0' })
    updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])

    expect(readCatalogConfig(tempDir)?.catalogs.default).toEqual({ nuxt: '^4.2.0' })
  })

  it('should keep an anchor when updating the entry that defines it', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'catalogs:\n  prod:\n    nuxt: &nuxt ^4.1.0\n  legacy:\n    nuxt: *nuxt\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'prod', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('catalogs:\n  prod:\n    nuxt: &nuxt ^4.2.0\n  legacy:\n    nuxt: *nuxt\n')
  })

  it('should fail rather than retarget an anchor through one of its aliases', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalogs:\n  prod:\n    nuxt: &nuxt ^4.1.0\n  legacy:\n    nuxt: *nuxt\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'legacy', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('failed')
  })

  it('should add a missing entry to an existing catalog', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'packages:\n  - packages/*\ncatalog:\n  vue: ^3.6.0 # pinned\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: '@nuxt/kit', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('packages:\n  - packages/*\ncatalog:\n  vue: ^3.6.0 # pinned\n  "@nuxt/kit": ^4.2.0\n')
  })

  it('should create the catalog blocks when the workspace has none', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'packages:\n  - packages/*\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(updateCatalogEntries(tempDir, [{ catalog: 'prod', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('packages:\n  - packages/*\ncatalog:\n  nuxt: ^4.2.0\ncatalogs:\n  prod:\n    nuxt: ^4.2.0\n')
  })

  it('should add a named catalog alongside existing ones', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'catalogs:\n  dev:\n    typescript: ^5.9.0\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'prod', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('catalogs:\n  dev:\n    typescript: ^5.9.0\n  prod:\n    nuxt: ^4.2.0\n')
  })

  it('should replace a quoted specifier and keep its trailing comment', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'catalog:\n  nuxt: "^4.1.0" # keep me\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.1.0' }])).toBe('unchanged')
    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: 'npm:nuxt-nightly@latest' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('catalog:\n  nuxt: npm:nuxt-nightly@latest # keep me\n')
  })

  it('should ignore a nested key that shares the catalog name', async () => {
    const filePath = join(tempDir, 'pnpm-workspace.yaml')
    await writeFile(filePath, 'overrides:\n  catalog:\n    nuxt: ^1.0.0\ncatalog:\n  nuxt: ^4.1.0\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('updated')
    expect(await readFile(filePath, 'utf-8')).toBe('overrides:\n  catalog:\n    nuxt: ^1.0.0\ncatalog:\n  nuxt: ^4.2.0\n')
  })

  it('should fail on a flow mapping it cannot edit line by line', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog: { nuxt: ^4.1.0 }\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('failed')
  })

  it('should fail when there is no workspace file', () => {
    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.2.0' }])).toBe('failed')
  })

  it('should fail when the workspace file cannot be parsed', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'catalog:\n  nuxt: "^4.2.0\n\tbad: [\n')

    expect(updateCatalogEntries(tempDir, [{ catalog: 'default', pkg: 'nuxt', specifier: '^4.3.0' }])).toBe('failed')
  })
})
