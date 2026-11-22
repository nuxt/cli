import { runCommand } from 'citty'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import build from '../../../src/commands/build'
import { logger } from '../../../src/utils/logger'

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  formatLockError: vi.fn(() => 'lock details'),
  acquireOutputLock: vi.fn(),
  buildNuxt: vi.fn(),
  clearBuildDir: vi.fn(),
  configureProjectConsola: vi.fn(),
  loadNuxt: vi.fn(),
  releaseBuildDir: vi.fn(),
  releaseOutputDir: vi.fn(),
  reportThroughClack: vi.fn(),
  startCpuProfile: vi.fn(),
  stopClackReporting: vi.fn(),
  stopCpuProfile: vi.fn(),
  useNitro: vi.fn(),
  writeTypes: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
}))
vi.mock('../../../src/utils/banner', () => ({
  showBanner: vi.fn(),
}))
vi.mock('../../../src/utils/console', () => ({
  configureProjectConsola: mocks.configureProjectConsola,
  reportThroughClack: mocks.reportThroughClack,
}))
vi.mock('../../../src/utils/env', () => ({
  overrideEnv: vi.fn(),
}))
vi.mock('../../../src/utils/fs', () => ({ clearBuildDir: mocks.clearBuildDir }))
vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({
    buildNuxt: mocks.buildNuxt,
    loadNuxt: mocks.loadNuxt,
    useNitro: mocks.useNitro,
    writeTypes: mocks.writeTypes,
  }),
}))
vi.mock('../../../src/utils/lockfile', () => ({
  acquireLock: mocks.acquireLock,
  acquireOutputLock: mocks.acquireOutputLock,
  formatLockError: mocks.formatLockError,
}))
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
  intro: vi.fn(),
  outro: vi.fn(),
}))
vi.mock('../../../src/utils/profile', () => ({
  startCpuProfile: mocks.startCpuProfile,
  stopCpuProfile: mocks.stopCpuProfile,
}))

const cwd = '/project'
const buildDir = '/project/.nuxt'
const outputDir = '/project/.output'

function run(args: string[] = [], data?: Record<string, any>) {
  return runCommand(build, {
    rawArgs: [cwd, ...args],
    data,
  })
}

describe('build', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadNuxt.mockResolvedValue({
      hook: vi.fn(),
      ready: vi.fn(),
      options: { buildDir, rootDir: cwd, ssr: true },
    })
    mocks.useNitro.mockReturnValue({
      options: {
        preset: 'node-server',
        output: { dir: outputDir, publicDir: `${outputDir}/public` },
      },
    })
    mocks.acquireLock.mockReturnValue({ release: mocks.releaseBuildDir })
    mocks.acquireOutputLock.mockReturnValue({ release: mocks.releaseOutputDir })
    mocks.reportThroughClack.mockReturnValue(mocks.stopClackReporting)
  })

  it.each([
    ['succeeds', undefined],
    [
      'fails',
      new Error('build failed'),
    ],
  ])('renders project logs through clack while the build runs, and stops when it %s', async (_, error) => {
    mocks.buildNuxt.mockImplementationOnce(async () => {
      expect(mocks.reportThroughClack).toHaveBeenCalledOnce()
      expect(mocks.configureProjectConsola).toHaveBeenCalledWith(cwd)
      expect(mocks.reportThroughClack.mock.invocationCallOrder[0]).toBeLessThan(mocks.loadNuxt.mock.invocationCallOrder[0]!)
      expect(mocks.configureProjectConsola.mock.invocationCallOrder[0]).toBeLessThan(mocks.loadNuxt.mock.invocationCallOrder[0]!)
      expect(mocks.stopClackReporting).not.toHaveBeenCalled()
      if (error) {
        throw error
      }
    })

    await (error
      ? expect(run()).rejects.toBe(error)
      : run())

    expect(mocks.stopClackReporting).toHaveBeenCalledOnce()
  })

  it('loads Nuxt with build arguments and runs the build in order', async () => {
    await run([
      '--prerender',
      '--preset=cloudflare',
      '--extends=base',
      '--profile=verbose',
    ], {
      overrides: {
        debug: { templates: true },
      },
    })

    expect(mocks.loadNuxt).toHaveBeenCalledWith({
      cwd,
      ready: false,
      dotenv: { cwd, fileName: undefined },
      envName: undefined,
      overrides: {
        logLevel: undefined,
        _generate: true,
        nitro: { static: true, preset: 'cloudflare' },
        extends: ['base'],
        debug: { templates: true, perf: true },
      },
    })
    expect(mocks.acquireLock).toHaveBeenCalledWith(buildDir, { command: 'build', cwd })
    expect(mocks.acquireOutputLock).toHaveBeenCalledWith(cwd, outputDir, { command: 'build', cwd })
    expect(mocks.clearBuildDir).toHaveBeenCalledWith(buildDir)
    expect(mocks.writeTypes).toHaveBeenCalled()
    expect(mocks.buildNuxt).toHaveBeenCalled()
    expect(mocks.startCpuProfile).toHaveBeenCalledOnce()
    expect(mocks.stopCpuProfile).toHaveBeenCalledWith(cwd, 'build')
    expect(mocks.releaseBuildDir).toHaveBeenCalledOnce()
    expect(mocks.releaseOutputDir).toHaveBeenCalledOnce()

    const calls = [
      mocks.acquireLock,
      mocks.acquireOutputLock,
      mocks.clearBuildDir,
      mocks.writeTypes,
      mocks.buildNuxt,
      mocks.releaseOutputDir,
      mocks.releaseBuildDir,
    ].map(mock => mock.mock.invocationCallOrder[0])
    expect(calls).toEqual([...calls].sort((a, b) => a! - b!))
  })

  it('should load every requested `.env` file, in the order given', async () => {
    await run([
      '--dotenv',
      '.env.development',
      '--dotenv',
      '.env.local',
    ])

    expect(mocks.loadNuxt).toHaveBeenCalledWith(expect.objectContaining({
      dotenv: {
        cwd,
        fileName: ['.env.development', '.env.local'],
      },
    }))
  })

  it('propagates build errors without terminating programmatic callers', async () => {
    const error = new Error('build failed')
    mocks.buildNuxt.mockRejectedValue(error)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await expect(run(['--profile'])).rejects.toBe(error)

    expect(exit).not.toHaveBeenCalled()
    expect(mocks.startCpuProfile).toHaveBeenCalledOnce()
    expect(mocks.releaseBuildDir).toHaveBeenCalledOnce()
    expect(mocks.releaseOutputDir).toHaveBeenCalledOnce()
    expect(mocks.stopCpuProfile).toHaveBeenCalledWith(cwd, 'build')
  })

  it('releases the build-directory lock when the output is already in use', async () => {
    mocks.acquireOutputLock.mockReturnValue({
      existing: {
        pid: 42,
        command: 'build',
        cwd: '/other/project',
        startedAt: Date.now(),
      },
    })

    await expect(run()).rejects.toThrow('lock details')
    expect(mocks.formatLockError).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 42 }),
      {
        outputDir: expect.stringContaining('.output'),
      },
    )

    expect(mocks.clearBuildDir).not.toHaveBeenCalled()
    expect(mocks.buildNuxt).not.toHaveBeenCalled()
    expect(mocks.releaseBuildDir).toHaveBeenCalledOnce()
  })

  it.each(['--target=vercel', '--preset=vercel'])('maps %s onto the Nitro preset', async (arg) => {
    mocks.buildNuxt.mockResolvedValue(undefined)

    await run([arg])

    expect(mocks.loadNuxt).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        nitro: { static: undefined, preset: 'vercel' },
      }),
    }))
  })

  it('names the deploy target the server builder declares', async () => {
    mocks.buildNuxt.mockResolvedValue(undefined)
    mocks.loadNuxt.mockResolvedValue({
      hook: vi.fn(),
      ready: vi.fn(),
      options: { buildDir, rootDir: cwd, ssr: true },
      serverBuild: {
        name: 'nitro',
        label: 'Nitro',
        targetLabel: 'preset',
        target: () => 'vercel',
        capabilities: { server: true, dev: true },
        output: {
          dir: () => outputDir,
          publicDir: () => `${outputDir}/public`,
        },
      },
    })

    await run()

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/^Deploy target: .*vercel/))
  })

  it.each([
    ['info', 1],
    ['silent', 0],
  ])('prints the bundle summary at log level %s %i times', async (logLevel, times) => {
    const hooks = new Map<string, (...args: any[]) => unknown>()
    mocks.loadNuxt.mockImplementation(({ overrides }) => Promise.resolve({
      hook: (name: string, fn: (...args: any[]) => unknown) => hooks.set(name, fn),
      ready: vi.fn(),
      options: {
        buildDir,
        rootDir: cwd,
        ssr: true,
        logLevel: overrides.logLevel,
      },
    }))
    mocks.buildNuxt.mockImplementation(async () => {
      await hooks.get('build:environment:done')!(
        { name: 'client', consumer: 'client', builder: 'vite' },
        { duration: 10, outDir: `${outputDir}/public`, files: [] },
      )
    })

    await run([`--logLevel=${logLevel}`])

    expect(vi.mocked(logger.success).mock.calls.filter(([message]) => String(message).includes('Client (vite) built'))).toHaveLength(times)
  })

  it('builds without a server, locking the default output directory', async () => {
    mocks.buildNuxt.mockResolvedValue(undefined)
    mocks.useNitro.mockImplementation(() => {
      throw new Error('Nitro is not initialized!')
    })
    mocks.loadNuxt.mockResolvedValue({
      hook: vi.fn(),
      ready: vi.fn(),
      options: {
        buildDir,
        rootDir: cwd,
        ssr: false,
        server: { builder: 'vite' },
      },
    })

    await run()

    expect(mocks.acquireOutputLock).toHaveBeenCalledWith(cwd, outputDir, { command: 'build', cwd })
    expect(mocks.buildNuxt).toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('preset'))
  })
})
