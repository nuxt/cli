import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectTemplatePackageManager } from '../../../src/commands/init'

describe('detectTemplatePackageManager', () => {
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

  it('detects the package manager from a lockfile', async () => {
    await writePkg({ name: 'app' })
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')

    expect(await detectTemplatePackageManager(dir)).toBe('pnpm')
  })

  it('detects the package manager from the `packageManager` field', async () => {
    await writePkg({ name: 'app', packageManager: 'yarn@4.0.0' })

    expect(await detectTemplatePackageManager(dir)).toBe('yarn')
  })

  it('returns undefined when the template pins no package manager', async () => {
    await writePkg({ name: 'app' })

    expect(await detectTemplatePackageManager(dir)).toBeUndefined()
  })
})
