import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { alignPackageManager } from '../../../src/commands/init'

describe('alignPackageManager', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-init-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writePkg(pkg: Record<string, unknown>) {
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  }

  async function readPkg() {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'))
  }

  it('removes the lockfile, marker files and `packageManager` field on mismatch', async () => {
    await writePkg({ name: 'app', packageManager: 'pnpm@9.0.0' })
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: []')

    await alignPackageManager(dir, 'npm')

    expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(false)
    expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
    expect((await readPkg()).packageManager).toBeUndefined()
  })

  it('keeps everything when the template already matches the selection', async () => {
    await writePkg({ name: 'app', packageManager: 'pnpm@9.0.0' })
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: []')

    await alignPackageManager(dir, 'pnpm')

    expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(true)
    expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(true)
    expect((await readPkg()).packageManager).toBe('pnpm@9.0.0')
  })

  it('removes a lockfile even when the template has no `packageManager` field', async () => {
    await writePkg({ name: 'app' })
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')

    await alignPackageManager(dir, 'npm')

    expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(false)
    expect((await readPkg()).packageManager).toBeUndefined()
  })

  it('is a no-op when the template pins no package manager', async () => {
    await writePkg({ name: 'app' })

    await expect(alignPackageManager(dir, 'npm')).resolves.not.toThrow()
    expect((await readPkg()).name).toBe('app')
  })
})
