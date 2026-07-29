import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadKit } from '../../../src/utils/kit'

let nodePath: string | undefined

// `vitest` points `NODE_PATH` at the pnpm store, where `@nuxt/kit` is resolvable
beforeEach(() => {
  nodePath = process.env.NODE_PATH
  delete process.env.NODE_PATH
})

afterEach(() => {
  process.env.NODE_PATH = nodePath
})

describe('loadKit', () => {
  it('should explain how to install `@nuxt/kit` when it cannot be resolved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'nuxi-kit-'))

    await expect(loadKit(rootDir)).rejects.toThrowError(
      'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3+ first.',
    )
  })
})
