import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findLockFile } from '../../../src/commands/upgrade'

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
