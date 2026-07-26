import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runCommand } from '../../../src/run'
import { logger } from '../../../src/utils/logger'

const { x, loadKit } = vi.hoisted(() => ({
  x: vi.fn((_bin: string, _args: string[]) => Promise.resolve({ exitCode: 0 })),
  loadKit: vi.fn(() => Promise.resolve({
    loadNuxt: () => Promise.resolve({ close: () => Promise.resolve() }),
    buildNuxt: () => Promise.resolve(),
    writeTypes: () => Promise.resolve(),
  })),
}))

vi.mock('tinyexec', () => ({ x }))
vi.mock('../../../src/utils/kit', () => ({ loadKit }))
vi.mock('exsolve', () => ({
  resolveModulePath: (id: string) => id.includes('vue-tsc') ? '/node_modules/vue-tsc/bin/vue-tsc.js' : '/node_modules/typescript/index.js',
}))

function fixture(name: string) {
  return fileURLToPath(new URL(`../../fixtures/typecheck/${name}`, import.meta.url))
}

async function run(cwd: string, ...args: string[]) {
  await runCommand('typecheck', ['--cwd', cwd, ...args])
  return x.mock.calls[0]?.[1]
}

describe('nuxt typecheck command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use build mode for Nuxt project references', async () => {
    expect(await run(fixture('nuxt-references'))).toEqual(['-b', '--noEmit'])
  })

  it('should not use build mode when the tsconfig has input files of its own', async () => {
    expect(await run(fixture('legacy-references/app'))).toEqual(['--noEmit'])
  })

  it('should respect an explicit --build flag', async () => {
    expect(await run(fixture('legacy-references/app'), '--build')).toEqual(['-b', '--noEmit'])
  })

  it('should respect an explicit --no-build flag', async () => {
    expect(await run(fixture('nuxt-references'), '--no-build')).toEqual(['--noEmit'])
  })

  it('should warn when Nuxt project references are referenced alongside input files', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await run(fixture('incomplete-references'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"files": []'))
    warn.mockRestore()
  })
})
