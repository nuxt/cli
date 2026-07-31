import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prompt = vi.hoisted(() => ({ answer: false as boolean }))

vi.mock('@clack/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clack/prompts')>()
  return { ...original, confirm: () => Promise.resolve(prompt.answer) }
})

const resolvedNuxt = vi.hoisted(() => ({ path: null as string | null, error: null as Error | null }))

vi.mock('../../src/utils/kit', () => ({
  tryResolveNuxt: () => {
    if (resolvedNuxt.error) {
      throw resolvedNuxt.error
    }
    return resolvedNuxt.path
  },
}))

const { locateProject, preflight } = await import('../../src/dev/preflight')

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'nuxt-preflight-test-'))
  resolvedNuxt.path = null
  resolvedNuxt.error = null
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function write(relativePath: string, contents = '') {
  const path = join(tempDir, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
  return path
}

function installNuxt() {
  resolvedNuxt.path = write('node_modules/nuxt/index.mjs', 'export default {}')
}

function createSubdirectory(name = 'app') {
  const path = join(tempDir, name)
  mkdirSync(path, { recursive: true })
  return path
}

describe('locateProject', () => {
  it('should recognise a directory with a nuxt config', () => {
    write('nuxt.config.ts')

    expect(locateProject(tempDir)).toEqual({ isProject: true })
  })

  it('should recognise a directory that only declares nuxt', () => {
    write('package.json', JSON.stringify({ devDependencies: { 'nuxt-nightly': 'latest' } }))

    expect(locateProject(tempDir)).toEqual({ isProject: true })
  })

  it('should recognise a config in `.config`', () => {
    write('.config/nuxt.ts')

    expect(locateProject(tempDir)).toEqual({ isProject: true })
  })

  it('should recognise a config `c12` parses rather than imports', () => {
    write('nuxt.config.jsonc')

    expect(locateProject(tempDir)).toEqual({ isProject: true })
  })

  it('should point at the nearest project when run from a subdirectory', () => {
    write('nuxt.config.mjs')
    mkdirSync(join(tempDir, 'app', 'pages'), { recursive: true })

    expect(locateProject(join(tempDir, 'app', 'pages'))).toEqual({ isProject: false, ancestor: tempDir })
  })

  it('should not treat an ancestor that only declares nuxt as a project', () => {
    write('package.json', JSON.stringify({ devDependencies: { nuxt: '^4' } }))

    expect(locateProject(createSubdirectory())).toEqual({ isProject: false })
  })

  it('should report no project at all', () => {
    write('package.json', JSON.stringify({ dependencies: { vue: '^3' } }))

    expect(locateProject(tempDir)).toEqual({ isProject: false })
  })

  it('should ignore an unparseable package.json', () => {
    write('package.json', '{ not json')

    expect(locateProject(tempDir)).toEqual({ isProject: false })
  })
})

describe('preflight', () => {
  it('should explain that the directory is not a Nuxt project', async () => {
    await expect(preflight({ cwd: tempDir, interactive: false })).rejects.toThrow(/No Nuxt project in[\s\S]*nuxt init/)
  })

  it('should offer to run in the project above instead', async () => {
    write('nuxt.config.ts')
    installNuxt()

    prompt.answer = true
    await expect(preflight({ cwd: createSubdirectory(), interactive: true })).resolves.toBe(tempDir)
  })

  it('should not move to the project above when the offer is declined', async () => {
    write('nuxt.config.ts')
    installNuxt()

    prompt.answer = false
    await expect(preflight({ cwd: createSubdirectory(), interactive: true })).rejects.toThrow(/cd \.\. && nuxt dev/)
  })

  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')('should explain a read-only build directory', async () => {
    write('nuxt.config.ts')
    installNuxt()
    const buildDir = join(tempDir, '.nuxt')
    mkdirSync(buildDir)
    chmodSync(buildDir, 0o555)

    try {
      await expect(preflight({ cwd: tempDir, interactive: false })).rejects.toThrow(/Nuxt cannot write to[\s\S]*chmod u\+w \.nuxt/)
    }
    finally {
      chmodSync(buildDir, 0o755)
    }
  })

  it('should explain that nuxt is not a dependency', async () => {
    write('nuxt.config.ts')
    write('package.json', JSON.stringify({ dependencies: { vue: '^3' } }))
    write('pnpm-lock.yaml')

    await expect(preflight({ cwd: tempDir, interactive: false })).rejects.toThrow(/pnpm add nuxt/)
  })

  it('should name the package manager from `packageManager` without a lockfile', async () => {
    write('nuxt.config.ts')
    write('package.json', JSON.stringify({ packageManager: 'yarn@4.5.0', dependencies: { vue: '^3' } }))

    await expect(preflight({ cwd: tempDir, interactive: false })).rejects.toThrow(/yarn add nuxt/)
  })

  it('should ask for an install when dependencies are missing', async () => {
    write('nuxt.config.ts')
    write('package.json', JSON.stringify({ dependencies: { nuxt: '^4' } }))
    write('pnpm-lock.yaml')

    await expect(preflight({ cwd: tempDir, interactive: false })).rejects.toThrow(/pnpm install/)
  })

  it('should pass a project that is ready to start', async () => {
    write('nuxt.config.ts')
    write('package.json', JSON.stringify({ dependencies: { nuxt: '^4' } }))
    write('pnpm-lock.yaml')
    installNuxt()

    await expect(preflight({ cwd: tempDir, interactive: false })).resolves.toBe(tempDir)
  })

  it('should never block the dev server on an unexpected failure', async () => {
    write('nuxt.config.ts')
    resolvedNuxt.error = new Error('resolution blew up')

    await expect(preflight({ cwd: tempDir, interactive: false })).resolves.toBe(tempDir)
  })
})
