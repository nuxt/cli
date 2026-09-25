import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearBuildDir, clearDir } from '../../../src/utils/fs'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nuxt-fs-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function populate(dir: string, entries: string[]) {
  mkdirSync(dir, { recursive: true })
  for (const entry of entries) {
    if (entry.endsWith('/')) {
      mkdirSync(join(dir, entry, 'nested'), { recursive: true })
      writeFileSync(join(dir, entry, 'nested/file.txt'), 'x')
      continue
    }
    writeFileSync(join(dir, entry), 'x')
  }
}

describe('clearDir', () => {
  it('should empty the directory', async () => {
    const dir = join(root, 'build')
    populate(dir, ['a.txt', 'b/', 'c.json'])

    await clearDir(dir)

    expect(readdirSync(dir)).toEqual([])
  })

  it('should create the directory when it does not exist', async () => {
    const dir = join(root, 'missing/nested')

    await clearDir(dir)

    expect(readdirSync(dir)).toEqual([])
  })

  it('should keep the excluded entries and drop everything else', async () => {
    const dir = join(root, 'build')
    populate(dir, ['keep.txt', 'drop.txt', 'keep-dir/', 'drop-dir/'])

    await clearDir(dir, ['keep.txt', 'keep-dir'])

    expect(readdirSync(dir).sort()).toEqual(['keep-dir', 'keep.txt'])
    expect(existsSync(join(dir, 'keep-dir/nested/file.txt'))).toBe(true)
  })

  it('should create the directory when clearing with exclusions and it does not exist', async () => {
    const dir = join(root, 'absent')

    await clearDir(dir, ['cache'])

    expect(readdirSync(dir)).toEqual([])
  })
})

describe('clearBuildDir', () => {
  it('should keep the cache and the analysis output', async () => {
    const dir = join(root, '.nuxt')
    populate(dir, ['cache/', 'analyze/', 'nuxt.json', 'nuxt.lock', 'dist/', 'manifest.json'])

    await clearBuildDir(dir)

    expect(readdirSync(dir).sort()).toEqual(['analyze', 'cache', 'nuxt.json', 'nuxt.lock'])
    expect(existsSync(join(dir, 'cache/nested/file.txt'))).toBe(true)
  })
})
