import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runCommand } from '../../../src/run'
import { logger } from '../../../src/utils/logger'

const { buildNuxt, closeNuxt, loadKit, resolveModulePath, writeTypes, x } = vi.hoisted(() => {
  const buildNuxt = vi.fn(() => Promise.resolve())
  const closeNuxt = vi.fn(() => Promise.resolve())
  const writeTypes = vi.fn(() => Promise.resolve())
  return {
    buildNuxt,
    closeNuxt,
    writeTypes,
    x: vi.fn((_bin: string, _args: string[]) => Promise.resolve({ exitCode: 0 })),
    loadKit: vi.fn(() => Promise.resolve({
      loadNuxt: () => Promise.resolve({ close: closeNuxt }),
      buildNuxt,
      writeTypes,
    })),
    resolveModulePath: vi.fn((id: string): string | undefined => id.includes('vue-tsc') ? '/node_modules/vue-tsc/bin/vue-tsc.js' : '/node_modules/typescript/index.js'),
  }
})

vi.mock('tinyexec', () => ({ x }))
vi.mock('../../../src/utils/kit', () => ({ loadKit }))
vi.mock('exsolve', () => ({ resolveModulePath }))

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
    process.exitCode = undefined
    resolveModulePath.mockImplementation((id: string) => id.includes('vue-tsc') ? '/node_modules/vue-tsc/bin/vue-tsc.js' : '/node_modules/typescript/index.js')
    x.mockResolvedValue({ exitCode: 0 })
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

  it('should not prepare Nuxt when the requested checker is unavailable', async () => {
    resolveModulePath.mockReturnValue(undefined)

    await run(fixture('nuxt-references'), '--checker', 'vue-tsc')

    expect(process.exitCode).toBe(1)
    expect(loadKit).not.toHaveBeenCalled()
  })

  it('should close Nuxt when preparing types fails', async () => {
    writeTypes.mockRejectedValueOnce(new Error('could not write types'))

    await expect(run(fixture('nuxt-references'))).rejects.toThrow('could not write types')
    expect(buildNuxt).not.toHaveBeenCalled()
    expect(closeNuxt).toHaveBeenCalledOnce()
  })

  it('should propagate the checker exit code', async () => {
    x.mockResolvedValueOnce({ exitCode: 2 })

    await run(fixture('nuxt-references'))

    expect(process.exitCode).toBe(2)
  })
})
