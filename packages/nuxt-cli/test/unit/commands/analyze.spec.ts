import type { Nuxt } from '@nuxt/schema'

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { runCommand } from 'citty'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import analyze from '../../../src/commands/analyze'
import { render, screen } from '../../utils/terminal'

type Hook = (...args: any[]) => unknown

function createHooks() {
  const hooks = new Map<string, Hook[]>()
  return {
    hook: (name: string, fn: Hook) => void hooks.set(name, [...hooks.get(name) || [], fn]),
    callHook: async (name: string, ...args: unknown[]) => {
      for (const fn of hooks.get(name) || []) {
        await fn(...args)
      }
    },
  }
}

const { acquireLock, acquireOutputLock, buildNuxt, formatLockError, loadNuxt, releaseBuildLock, releaseOutputLock } = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  formatLockError: vi.fn(() => 'locked'),
  acquireOutputLock: vi.fn(),
  buildNuxt: vi.fn(),
  loadNuxt: vi.fn(),
  releaseBuildLock: vi.fn(),
  releaseOutputLock: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxt, buildNuxt }),
}))

vi.mock('../../../src/utils/lockfile', () => ({
  acquireLock,
  acquireOutputLock,
  formatLockError,
}))

let cwd: string

async function runAnalyze({ args = [], routes = [] }: { args?: string[], routes?: string[] } = {}) {
  const nuxtHooks = createHooks()
  const prerenderRoutes = new Set(routes)
  let overrides: Record<string, any> = {}

  loadNuxt.mockImplementation((options: { overrides: Record<string, any> }) => {
    overrides = options.overrides
    return Promise.resolve({
      ...nuxtHooks,
      ready: () => Promise.resolve(),
      options: {
        analyzeDir: join(cwd, 'analyze'),
        buildDir: join(cwd, '.nuxt'),
        rootDir: cwd,
        nitro: {},
        build: {},
      },
    } as unknown as Nuxt)
  })

  buildNuxt.mockImplementation(async () => {
    await mkdir(join(cwd, 'analyze'), { recursive: true })
    const nitroHooks = createHooks()
    await nuxtHooks.callHook('nitro:init', { hooks: nitroHooks })
    await nitroHooks.callHook('prerender:routes', prerenderRoutes)
  })

  const renderer = await render(() => runCommand(analyze, { rawArgs: [`--cwd=${cwd}`, '--no-serve', ...args] }))

  const ignore: ((path: string) => unknown)[] = overrides.nitro?.prerender?.ignore || []
  return {
    output: screen(renderer),
    overrides,
    prerendered: [...prerenderRoutes].filter(route => !ignore.some(matches => matches(route))),
  }
}

describe('nuxt analyze command', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    acquireLock.mockReturnValue({ release: releaseBuildLock })
    acquireOutputLock.mockReturnValue({ release: releaseOutputLock })
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-analyze-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('should not prerender any routes by default', async () => {
    const { prerendered, overrides } = await runAnalyze({ routes: ['/', '/about'] })
    expect(prerendered).toEqual([])
    expect(overrides.nitro.prerender.crawlLinks).toBe(false)
  })

  it('should report the routes it skipped prerendering', async () => {
    const { output } = await runAnalyze({ routes: ['/', '/about'] })
    expect(output).toContain('Skipped prerendering 2 routes')
    expect(output).toContain('--prerender')
  })

  it('should say nothing when there was nothing to prerender', async () => {
    const { output } = await runAnalyze()
    expect(output).not.toContain('prerender')
  })

  it('should prerender when the --prerender flag is passed', async () => {
    const { prerendered, overrides, output } = await runAnalyze({ args: ['--prerender'], routes: ['/', '/about'] })
    expect(prerendered).toEqual(['/', '/about'])
    expect(overrides.nitro?.prerender).toBeUndefined()
    expect(output).not.toContain('Skipped prerendering')
  })

  it('should write metadata and fall back to a non-empty slug', async () => {
    await runAnalyze({ args: ['--name=   '] })

    const meta = JSON.parse(await readFile(join(cwd, 'analyze/meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      name: '   ',
      slug: 'default',
      analyzeDir: join(cwd, 'analyze'),
      buildDir: join(cwd, '.nuxt'),
      outDir: join(cwd, '.output'),
    })
    expect(meta.endTime).toBeGreaterThanOrEqual(meta.startTime)
  })

  it('should lock build directories and release both locks', async () => {
    await runAnalyze()

    expect(acquireLock).toHaveBeenCalledWith(join(cwd, '.nuxt'), { command: 'analyze', cwd })
    expect(acquireOutputLock).toHaveBeenCalledWith(cwd, join(cwd, '.output'), { command: 'analyze', cwd })
    expect(releaseOutputLock).toHaveBeenCalledOnce()
    expect(releaseBuildLock).toHaveBeenCalledOnce()
  })

  it('should release locks when the build fails', async () => {
    buildNuxt.mockRejectedValueOnce(new Error('build failed'))

    await expect(runAnalyze()).rejects.toThrow('build failed')
    expect(releaseOutputLock).toHaveBeenCalledOnce()
    expect(releaseBuildLock).toHaveBeenCalledOnce()
  })

  it('should release the build lock when the output is locked', async () => {
    acquireOutputLock.mockReturnValueOnce({
      existing: { command: 'build', pid: 42 },
    })

    await expect(runAnalyze()).rejects.toThrow('locked')
    expect(formatLockError).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 42 }),
      { outputDir: expect.stringContaining('.output') },
    )
    expect(buildNuxt).not.toHaveBeenCalled()
    expect(releaseBuildLock).toHaveBeenCalledOnce()
  })
})
