import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { answers, progress, detectPackageManager, getNuxtVersion, resolveRegistryVersion, runDedupe, runInstall } = vi.hoisted(() => ({
  answers: { select: [] as unknown[] },
  progress: [] as string[],
  detectPackageManager: vi.fn(),
  getNuxtVersion: vi.fn(),
  resolveRegistryVersion: vi.fn(),
  runDedupe: vi.fn(),
  runInstall: vi.fn(),
}))

vi.mock('@clack/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clack/prompts')>()
  return {
    ...original,
    select: vi.fn(() => Promise.resolve(answers.select.length ? answers.select.shift() : 'skip')),
    spinner: vi.fn(() => {
      const record = (message?: string) => void (message && progress.push(message))
      return { start: record, stop: record, error: record, message: record }
    }),
  }
})

vi.mock('nypm', async importOriginal => ({
  ...await importOriginal<typeof import('nypm')>(),
  detectPackageManager,
}))

vi.mock('../../../src/utils/install', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/install')>(),
  runDedupe,
  runInstall,
}))

vi.mock('../../../src/utils/versions', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/versions')>(),
  getNuxtVersion,
  resolveRegistryVersion,
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxtConfig: () => Promise.resolve({ buildDir: '.nuxt' }) }),
  tryResolveNuxt: () => undefined,
}))

const { runCommandDef } = await import('../../../src/run-command')
const { render, screen } = await import('../../utils/terminal')
const upgrade = await import('../../../src/commands/upgrade').then(r => r.default)

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

let cwd: string

async function runUpgrade(argv: string[] = []): Promise<{ output: string, exitCode: number | undefined }> {
  let exitCode: number | undefined
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number | undefined
    throw new ExitError(exitCode)
  })

  const renderer = await render(async () => {
    await runCommandDef(upgrade, [`--cwd=${cwd}`, ...argv]).catch((error) => {
      if (!(error instanceof ExitError)) {
        throw error
      }
    })
  })

  exit.mockRestore()
  return { output: [...progress, renderer.frames.join('\n'), screen(renderer)].join('\n'), exitCode }
}

async function writeProject(files: Record<string, string>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(cwd, name), contents)
  }
}

const installed = { success: true, output: '', command: 'pnpm install', ignoredBuilds: [] }

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-upgrade-'))
  answers.select.length = 0
  progress.length = 0
  vi.clearAllMocks()
  detectPackageManager.mockResolvedValue({ name: 'pnpm', command: 'pnpm', lockFile: ['pnpm-lock.yaml'] })
  getNuxtVersion.mockResolvedValue('4.0.0')
  resolveRegistryVersion.mockResolvedValue('4.1.0')
  runInstall.mockResolvedValue(installed)
  runDedupe.mockResolvedValue(installed)
  await writeProject({
    'package.json': JSON.stringify({ name: 'app', dependencies: { nuxt: '^4.0.0' } }),
    'pnpm-lock.yaml': '',
  })
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('upgrade preconditions', () => {
  it('should explain how to fix an undetectable package manager', async () => {
    detectPackageManager.mockResolvedValue(undefined)

    const { output, exitCode } = await runUpgrade()

    expect(exitCode).toBe(1)
    expect(output).toContain('Unable to determine the package manager')
    expect(output).toContain('packageManager')
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should carry on without a lock file but say it is missing', async () => {
    await rm(join(cwd, 'pnpm-lock.yaml'))

    const { output } = await runUpgrade()

    expect(output).toContain('Unable to find a pnpm lock file')
    expect(runInstall).toHaveBeenCalledTimes(1)
  })
})

describe('upgrade install', () => {
  it('should install the requested channel', async () => {
    await runUpgrade(['--channel=v3'])

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ dependencies: ['nuxt@3'] }))
  })

  it('should upgrade the core packages the project depends on', async () => {
    await writeProject({ 'package.json': JSON.stringify({ name: 'app', devDependencies: { 'nuxt': '^4.0.0', '@nuxt/kit': '^4.0.0' } }) })

    await runUpgrade()

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      dependencies: ['nuxt@latest', '@nuxt/kit@latest'],
      dev: true,
    }))
  })

  it('should stop when the install fails', async () => {
    runInstall.mockResolvedValue({ ...installed, success: false, error: 'pnpm ERR! offline', output: 'pnpm ERR! offline' })

    const { output, exitCode } = await runUpgrade()

    expect(exitCode).toBe(1)
    expect(output).toContain('pnpm ERR! offline')
    expect(runDedupe).not.toHaveBeenCalled()
  })

  it('should dedupe when asked to', async () => {
    await runUpgrade(['--dedupe'])

    expect(runDedupe).toHaveBeenCalledWith(expect.objectContaining({ recreateLockfile: false }))
  })

  it('should recreate the lockfile when forced, and say how to undo it', async () => {
    const { output } = await runUpgrade(['--force'])

    expect(runDedupe).toHaveBeenCalledWith(expect.objectContaining({ recreateLockfile: true }))
    expect(output).toContain('--no-force')
  })

  it('should report an upgrade that changed the version', async () => {
    getNuxtVersion.mockResolvedValueOnce('4.0.0').mockResolvedValueOnce('4.1.0')

    const { output } = await runUpgrade()

    expect(output).toContain('Successfully upgraded Nuxt')
    expect(output).toContain('4.1.0')
  })

  it('should say when the project was already up to date', async () => {
    const { output } = await runUpgrade()

    expect(output).toContain('already using the latest version')
  })
})

describe('upgrade with a pnpm catalog', () => {
  const workspace = 'packages:\n  - .\ncatalog:\n  nuxt: ^4.0.0\n'

  beforeEach(async () => {
    await writeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { nuxt: 'catalog:' } }),
      'pnpm-workspace.yaml': workspace,
    })
  })

  it('should update the catalog entry rather than pinning it in package.json', async () => {
    const { output } = await runUpgrade()

    expect(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8')).toContain('nuxt: ^4.1.0')
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')).dependencies.nuxt).toBe('catalog:')
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ dependencies: [] }))
    expect(output).toContain('Catalog entries updated')
  })

  it('should leave the catalog alone for a package manager without catalogs', async () => {
    detectPackageManager.mockResolvedValue({ name: 'npm', command: 'npm', lockFile: ['package-lock.json'] })
    await writeProject({ 'package-lock.json': '{}' })

    await runUpgrade()

    expect(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace)
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ dependencies: ['nuxt@latest'] }))
  })

  it('should stop when nuxt cannot be resolved for the catalog', async () => {
    resolveRegistryVersion.mockResolvedValue(undefined)

    const { output, exitCode } = await runUpgrade()

    expect(exitCode).toBe(1)
    expect(output).toContain('Unable to resolve a latest stable version')
    expect(output).toContain('DEBUG=nuxi')
    expect(output).toContain('Unable to upgrade')
    expect(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace)
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should stop when the workspace file cannot be rewritten', async () => {
    await writeProject({ 'pnpm-workspace.yaml': 'catalog:\n  nuxt: *missing-anchor\n' })

    const { output, exitCode } = await runUpgrade()

    expect(exitCode).toBe(1)
    expect(output).toContain('pnpm-workspace.yaml')
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should tell the user the catalog moved on when the install then fails', async () => {
    runInstall.mockResolvedValue({ ...installed, success: false, error: 'pnpm ERR! offline' })

    const { output, exitCode } = await runUpgrade()

    expect(exitCode).toBe(1)
    expect(output).toContain('catalog entries were already updated')
  })

  it('should keep the range operator the catalog entry used', async () => {
    await writeProject({ 'pnpm-workspace.yaml': 'catalog:\n  nuxt: 4.0.0\n' })

    await runUpgrade()

    expect(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8')).toContain('nuxt: 4.1.0')
  })
})
