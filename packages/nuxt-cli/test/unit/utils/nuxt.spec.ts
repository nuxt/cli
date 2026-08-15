import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../../../src/utils/nuxt'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nuxt-cleanup-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seed(...dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, dir, 'file.txt'), 'x')
  }
}

describe('cleanupNuxtDirs', () => {
  it('should remove the generated directories', async () => {
    await seed('.nuxt', '.output', 'dist', 'node_modules/.vite', 'node_modules/.cache', 'app')

    await cleanupNuxtDirs(root, '.nuxt', { silent: true })

    for (const dir of ['.nuxt', '.output', 'dist', 'node_modules/.vite', 'node_modules/.cache']) {
      expect(existsSync(join(root, dir)), dir).toBe(false)
    }
    expect(existsSync(join(root, 'app'))).toBe(true)
  })

  it('should refuse a build directory that is the project root', async () => {
    await seed('app')

    await expect(cleanupNuxtDirs(root, '.', { silent: true })).rejects.toThrow('contains the project root')
    expect(existsSync(join(root, 'app'))).toBe(true)
  })

  it('should refuse a build directory that contains the project root', async () => {
    await seed('app')

    await expect(cleanupNuxtDirs(root, '..', { silent: true })).rejects.toThrow('contains the project root')
    expect(existsSync(join(root, 'app'))).toBe(true)
  })
})

describe('nuxtVersionToGitIdentifier', () => {
  it('should use the git identifier of a nightly version', () => {
    expect(nuxtVersionToGitIdentifier('3.0.0-rc.8-27677607.a3a8706')).toBe('a3a8706')
  })

  it('should fall back to the release tag', () => {
    expect(nuxtVersionToGitIdentifier('3.0.0-rc.8')).toBe('v3.0.0-rc.8')
    expect(nuxtVersionToGitIdentifier('4.1.0')).toBe('v4.1.0')
  })
})
