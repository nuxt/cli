import { beforeEach, describe, expect, it, vi } from 'vitest'
import upgradeCommand, { normaliseLockFile } from '../../../src/commands/upgrade'

const {
  existsSync,
  loggerError,
  loggerStep,
  loggerSuccess,
  loggerInfo,
  detectPackageManager,
  addDependency,
  dedupeDependencies,
  findWorkspaceDir,
  readPackageJSON,
  getNuxtVersion,
  cleanupNuxtDirs,
  loadKit,
  getPackageManagerVersion,
  intro,
  note,
  outro,
  cancel,
  select,
  isCancel,
  tasks,
  spinStart,
  spinStop,
  nuxtVersionToGitIdentifier,
} = vi.hoisted(() => {
  return {
    existsSync: vi.fn(),
    loggerError: vi.fn(),
    loggerStep: vi.fn(),
    loggerSuccess: vi.fn(),
    loggerInfo: vi.fn(),
    detectPackageManager: vi.fn(),
    addDependency: vi.fn(),
    dedupeDependencies: vi.fn(),
    findWorkspaceDir: vi.fn(),
    readPackageJSON: vi.fn(),
    getNuxtVersion: vi.fn(),
    cleanupNuxtDirs: vi.fn(),
    loadKit: vi.fn(),
    getPackageManagerVersion: vi.fn(),
    intro: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    tasks: vi.fn(async (taskEntries: Array<{ task?: () => Promise<unknown> }>) => {
      for (const taskEntry of taskEntries) {
        await taskEntry.task?.()
      }
    }),
    spinStart: vi.fn(),
    spinStop: vi.fn(),
    nuxtVersionToGitIdentifier: vi.fn((version: string) => version),
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync,
  }
})

vi.mock('@clack/prompts', async () => {
  return {
    intro,
    note,
    outro,
    cancel,
    select,
    isCancel,
    tasks,
    spinner: () => ({
      start: spinStart,
      stop: spinStop,
    }),
  }
})

vi.mock('nypm', async () => {
  return {
    detectPackageManager,
    addDependency,
    dedupeDependencies,
  }
})

vi.mock('pkg-types', async () => {
  return {
    findWorkspaceDir,
    readPackageJSON,
  }
})

vi.mock('../../../src/utils/versions', async () => {
  return {
    getNuxtVersion,
  }
})

vi.mock('../../../src/utils/nuxt', async () => {
  return {
    cleanupNuxtDirs,
    nuxtVersionToGitIdentifier,
  }
})

vi.mock('../../../src/utils/kit', async () => {
  return {
    loadKit,
  }
})

vi.mock('../../../src/utils/packageManagers', async () => {
  return {
    getPackageManagerVersion,
  }
})

vi.mock('../../../src/utils/logger', async () => {
  return {
    logger: {
      error: loggerError,
      step: loggerStep,
      success: loggerSuccess,
      info: loggerInfo,
    },
  }
})

describe('normaliseLockFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves lockfiles across workspace and project directories', () => {
    existsSync.mockImplementation((filePath: string) => filePath.endsWith('/apps/web/package-lock.json'))

    const lockFile = normaliseLockFile(['/workspace', '/apps/web'], ['pnpm-lock.yaml', 'package-lock.json'])

    expect(lockFile).toBe('package-lock.json')
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('logs an error when no lockfile is found in any candidate directory', () => {
    existsSync.mockReturnValue(false)

    const lockFile = normaliseLockFile(['/workspace', '/apps/web'], ['pnpm-lock.yaml'])

    expect(lockFile).toBeUndefined()
    expect(loggerError).toHaveBeenCalledTimes(1)
    const [errorMessage] = loggerError.mock.calls[0]!
    expect(errorMessage).toContain('workspace')
    expect(errorMessage).toContain('apps/web')
  })

  it('supports string inputs for cwd and lockfile candidates', () => {
    existsSync.mockImplementation((filePath: string) => filePath.endsWith('/apps/web/pnpm-lock.yaml'))

    const lockFile = normaliseLockFile('/apps/web', 'pnpm-lock.yaml')

    expect(lockFile).toBe('pnpm-lock.yaml')
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('returns undefined when lockfile candidates are missing', () => {
    existsSync.mockReturnValue(false)

    const lockFile = normaliseLockFile(['/workspace', '/apps/web'], undefined)

    expect(lockFile).toBeUndefined()
    expect(existsSync).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  it('handles duplicate directories in cwd candidates', () => {
    existsSync.mockImplementation((filePath: string) => filePath.endsWith('/apps/web/package-lock.json'))

    const lockFile = normaliseLockFile(['/apps/web', '/apps/web'], ['package-lock.json'])

    expect(lockFile).toBe('package-lock.json')
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('returns lockfile when it exists in the first directory', () => {
    existsSync.mockImplementation((filePath: string) => filePath.endsWith('/workspace/pnpm-lock.yaml'))

    const lockFile = normaliseLockFile(['/workspace', '/apps/web'], ['pnpm-lock.yaml'])

    expect(lockFile).toBe('pnpm-lock.yaml')
    expect(loggerError).not.toHaveBeenCalled()
  })

  describe('upgrade command integration', () => {
    beforeEach(() => {
      detectPackageManager.mockResolvedValue({
        name: 'npm',
        lockFile: ['package-lock.json'],
      })
      findWorkspaceDir.mockResolvedValue('/workspace')
      readPackageJSON.mockResolvedValue({ dependencies: { nuxt: '^4.3.1' } })
      getNuxtVersion.mockResolvedValueOnce('4.3.1').mockResolvedValueOnce('4.3.2')
      addDependency.mockResolvedValue(undefined)
      dedupeDependencies.mockResolvedValue(undefined)
      cleanupNuxtDirs.mockResolvedValue(undefined)
      loadKit.mockResolvedValue({
        loadNuxtConfig: vi.fn().mockResolvedValue({ buildDir: '.nuxt' }),
      })
      getPackageManagerVersion.mockReturnValue('10.9.4')
      select.mockImplementation(async (opts: { message: string }) => opts.message.includes('nightly') ? '4.x' : 'dedupe')
    })

    it('checks both workspace and project directories during upgrade command run', async () => {
      existsSync.mockImplementation((filePath: string) => filePath.endsWith('/apps/web/package-lock.json'))

      const run = upgradeCommand.run
      if (!run) {
        throw new Error('upgrade command run handler is missing')
      }

      await run({
        args: {
          cwd: '/apps/web',
          rootDir: '/apps/web',
          dedupe: true,
          force: false,
          channel: 'stable',
        },
      } as any)

      const lockfileChecks = existsSync.mock.calls
        .map(([filePath]) => String(filePath))
        .filter(filePath => filePath.endsWith('package-lock.json'))

      expect(lockfileChecks).toEqual(expect.arrayContaining([
        expect.stringContaining('workspace'),
        expect.stringContaining('apps/web'),
      ]))
      expect(addDependency).toHaveBeenCalledTimes(1)
    })
  })
})
