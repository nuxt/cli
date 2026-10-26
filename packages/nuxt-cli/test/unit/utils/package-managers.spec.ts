import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { detectPackageManager, getLockFiles, getPackageManagerVersion } from '../../../src/utils/package-managers'

const SEMVER_RE = /^\d+\.\d+\.\d+/

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
})

describe('getLockFiles', () => {
  it('should not include workspace manifests', () => {
    expect(getLockFiles('pnpm')).toEqual(['pnpm-lock.yaml'])
  })
})

describe('getPackageManagerVersion', () => {
  const warnings: unknown[] = []
  beforeAll(() => {
    const original = process.emitWarning
    process.emitWarning = (warning: string | Error, ...args: any[]) => {
      warnings.push(warning, ...args)
      return (original as any)(warning, ...args)
    }
    return () => {
      process.emitWarning = original
    }
  })
  afterEach(() => {
    expect(warnings).not.toContain('DEP0190')
  })

  it('returns the command version', async () => {
    await expect(getPackageManagerVersion(process.execPath)).resolves.toBe(process.version)
  })

  it('returns the version of a package manager shim', async () => {
    await expect(getPackageManagerVersion('npm')).resolves.toMatch(SEMVER_RE)
  })

  it('does not fail when the package manager is unavailable', async () => {
    await expect(getPackageManagerVersion('nuxt-cli-missing-package-manager')).resolves.toBe('unknown')
  })
})
