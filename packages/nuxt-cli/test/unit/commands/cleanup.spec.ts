import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { runCommand } from 'citty'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import cleanup from '../../../src/commands/cleanup'

const { loadNuxtConfig } = vi.hoisted(() => ({
  loadNuxtConfig: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxtConfig }),
}))

let cwd: string

async function createFile(path: string) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '')
}

describe('cleanup', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-cleanup-'))
    loadNuxtConfig.mockResolvedValue({ rootDir: cwd, buildDir: join(cwd, '.nuxt') })
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('loads the development config and removes generated directories', async () => {
    const generated = [
      '.nuxt/nuxt.json',
      '.output/server/index.mjs',
      'dist/index.html',
      'node_modules/.vite/cache',
      'node_modules/.cache/nuxt/client.json',
    ]
    await Promise.all(generated.map(path => createFile(join(cwd, path))))
    await createFile(join(cwd, 'node_modules/nuxt/package.json'))

    await runCommand(cleanup, { rawArgs: [cwd] })

    expect(loadNuxtConfig).toHaveBeenCalledWith({ cwd, overrides: { dev: true } })
    expect(generated.every(path => !existsSync(join(cwd, path)))).toBe(true)
    expect(existsSync(join(cwd, 'node_modules/nuxt/package.json'))).toBe(true)
  })

  it('removes a custom build directory only once when it overlaps a cache directory', async () => {
    const buildDir = join(cwd, 'node_modules/.cache')
    loadNuxtConfig.mockResolvedValue({ rootDir: cwd, buildDir })
    await createFile(join(buildDir, 'nuxt/client.json'))

    await expect(runCommand(cleanup, { rawArgs: [cwd] })).resolves.toBeDefined()
  })

  it.each([
    ['the project root', () => cwd],
    ['a parent of the project root', () => join(cwd, '..')],
  ])('refuses to remove %s', async (_, getBuildDir) => {
    loadNuxtConfig.mockResolvedValue({ rootDir: cwd, buildDir: getBuildDir() })
    await createFile(join(cwd, 'package.json'))

    await expect(runCommand(cleanup, { rawArgs: [cwd] })).rejects.toThrow('Cannot clean a build directory that contains the project root.')
    expect(existsSync(join(cwd, 'package.json'))).toBe(true)
  })
})
