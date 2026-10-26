import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it, onTestFinished } from 'vitest'

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
})

describe('getLockFiles', () => {
  it('should not include workspace manifests', () => {
    expect(getLockFiles('pnpm')).toEqual(['pnpm-lock.yaml'])
  })
})

describe('getPackageManagerVersion', () => {
  // Node emits DEP0190 once per process, so this runs before any other shell spawn.
  it('does not warn about shell arguments when the platform is win32', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const original = process.emitWarning
    const warnings: unknown[] = []
    const recorder = (warning: string | Error, ...args: any[]) => {
      warnings.push(warning, ...args)
      return (original as any)(warning, ...args)
    }
    onTestFinished(() => {
      process.emitWarning = original
      Object.defineProperty(process, 'platform', platform)
    })
    process.emitWarning = recorder
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })

    // Node spawns `cmd.exe` for `win32`, so the version is only readable on Windows.
    await expect(getPackageManagerVersion(process.execPath)).resolves.toBeTypeOf('string')

    expect(warnings).not.toContain('DEP0190')
  })

  it('returns the command version', async () => {
    await expect(getPackageManagerVersion(process.execPath)).resolves.toBe(process.version)
  })

  it('does not fail when the package manager is unavailable', async () => {
    await expect(getPackageManagerVersion('nuxt-cli-missing-package-manager')).resolves.toBe('unknown')
  })
})
