import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import { readDependencyPackageJson } from '../../../src/utils/package-json'

/** This package's own directory, where its dependencies resolve from. */
const packageDir = fileURLToPath(new URL('../../../', import.meta.url))

describe('readDependencyPackageJson', () => {
  it('should read the manifest of an installed dependency', async () => {
    const pkg = await readDependencyPackageJson('pathe', packageDir)

    expect(pkg?.name).toBe('pathe')
  })

  it('should read the manifest of a dependency that does not export it', async () => {
    const pkg = await readDependencyPackageJson('scule', packageDir)

    expect(pkg?.name).toBe('scule')
  })

  it('should return `undefined` for a package that is not installed', async () => {
    await expect(readDependencyPackageJson('not-a-real-package-xyz', packageDir)).resolves.toBeUndefined()
  })

  it('should not fall back to the manifest of the consuming project', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-pkg-')))
    await writeFile(join(cwd, 'package.json'), '{"name":"my-project","version":"1.2.3"}', 'utf8')

    await expect(readDependencyPackageJson('nuxt', cwd)).resolves.toBeUndefined()
  })
})
