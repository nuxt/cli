import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { importTestUtils } from '../../../src/commands/test'

const tempDirs: string[] = []

async function createProject(packageName?: string, source = 'export function runTests() {}') {
  const rootDir = join(tmpdir(), `nuxt-test-command-${crypto.randomUUID()}`)
  tempDirs.push(rootDir)
  await mkdir(rootDir, { recursive: true })

  if (packageName) {
    const packageDir = join(rootDir, 'node_modules', ...packageName.split('/'))
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: packageName, type: 'module', exports: './index.js' }))
    await writeFile(join(packageDir, 'index.js'), source)
  }

  return rootDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('importTestUtils', () => {
  it('loads test utils from the project', async () => {
    const rootDir = await createProject('@nuxt/test-utils')

    expect((await importTestUtils(rootDir)).runTests).toBeTypeOf('function')
  })

  it('prefers nightly when multiple variants are installed', async () => {
    const rootDir = await createProject('@nuxt/test-utils-nightly', 'export function runTests() {}; export const channel = "nightly"')
    const packageDir = join(rootDir, 'node_modules', '@nuxt', 'test-utils')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@nuxt/test-utils', type: 'module', exports: './index.js' }))
    await writeFile(join(packageDir, 'index.js'), 'export function runTests() {}; export const channel = "stable"')

    expect((await importTestUtils(rootDir) as any).channel).toBe('nightly')
  })

  it('does not fall back when an installed variant fails to load', async () => {
    const rootDir = await createProject('@nuxt/test-utils-nightly', 'import "missing-dependency"; export function runTests() {}')

    await expect(importTestUtils(rootDir)).rejects.toThrow(/missing-dependency/)
  })

  it('reports an incompatible installed version', async () => {
    const rootDir = await createProject('@nuxt/test-utils', 'export const setup = true')

    await expect(importTestUtils(rootDir)).rejects.toThrow('The installed version of `@nuxt/test-utils` does not support `nuxt test`.')
  })

  it('reports a missing project dependency', async () => {
    const rootDir = await createProject()

    await expect(importTestUtils(rootDir)).rejects.toThrow('`@nuxt/test-utils` is not installed in this project.')
  })
})
