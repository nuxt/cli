import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const tempDirs: string[] = []

async function vueProject(...versions: string[]) {
  const cwd = await mkdtemp(join(tmpdir(), 'nuxt-typecheck-'))
  tempDirs.push(cwd)
  for (const [index, version] of versions.entries()) {
    const vueDir = index === 0
      ? join(cwd, 'node_modules/vue')
      : join(cwd, `node_modules/dependency-${index}/node_modules/vue`)
    await mkdir(vueDir, { recursive: true })
    await writeFile(join(vueDir, 'package.json'), JSON.stringify({ name: 'vue', version }))
  }
  return cwd
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

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
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

  it('should warn when multiple Vue versions are installed', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    x.mockResolvedValueOnce({ exitCode: 2 })

    await run(await vueProject('3.5.40', '3.5.41'))

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3.5.40, 3.5.41'))
    warn.mockRestore()
  })

  it('should not warn for duplicate copies of the same Vue version', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    x.mockResolvedValueOnce({ exitCode: 2 })

    await run(await vueProject('3.5.41', '3.5.41'))

    expect(warn).not.toHaveBeenCalled()
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
