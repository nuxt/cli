import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getNuxtVersion } from '../../../src/utils/versions'

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
