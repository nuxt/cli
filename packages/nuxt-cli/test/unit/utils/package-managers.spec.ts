import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { detectPackageManager, getLockFiles, getPackageManagerVersion } from '../../../src/utils/package-managers'

describe('detectPackageManager', () => {
  async function createNestedProject() {
    const root = await mkdtemp(join(tmpdir(), 'nuxt-pm-test-'))
    const app = join(root, 'app')
    await mkdir(app)
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    return { root, app }
  }

  it('should prefer the nearest project over a parent workspace', async () => {
    const { app } = await createNestedProject()
    await writeFile(join(app, 'package.json'), JSON.stringify({ packageManager: 'yarn@1.22.0' }))

    expect((await detectPackageManager(app))?.name).toBe('yarn')
  })

  it('should not look above `cwd` when `includeParentDirs` is false', async () => {
    const { app } = await createNestedProject()

    expect((await detectPackageManager(app))?.name).toBe('pnpm')
    expect(await detectPackageManager(app, { includeParentDirs: false })).toBeUndefined()
  })

  it('should detect upm from `upm.lock`', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nuxt-pm-test-'))
    await writeFile(join(dir, 'upm.lock'), '')

    expect(await detectPackageManager(dir)).toEqual({ name: 'upm', agent: 'upm' })
  })
})

describe('getLockFiles', () => {
  it('should not include workspace manifests', () => {
    expect(getLockFiles('pnpm')).toEqual(['pnpm-lock.yaml'])
  })

  it('should return the upm lockfile', () => {
    expect(getLockFiles('upm')).toEqual(['upm.lock'])
  })
})

describe('getPackageManagerVersion', () => {
  it('returns the command version', async () => {
    await expect(getPackageManagerVersion(process.execPath)).resolves.toBe(process.version)
  })

  it('does not fail when the package manager is unavailable', async () => {
    await expect(getPackageManagerVersion('nuxt-cli-missing-package-manager')).resolves.toBe('unknown')
  })
})
