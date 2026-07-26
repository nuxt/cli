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
})
