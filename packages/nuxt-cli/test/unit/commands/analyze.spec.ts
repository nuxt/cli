import type { Nuxt } from '@nuxt/schema'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { runCommand } from 'citty'
import { dirname, join } from 'pathe'
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

const { acquireLock, acquireOutputLock, buildNuxt, formatLockError, loadNuxt, releaseBuildLock, releaseOutputLock, serve } = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  formatLockError: vi.fn(() => 'locked'),
  acquireOutputLock: vi.fn(),
  buildNuxt: vi.fn(),
  loadNuxt: vi.fn(),
  releaseBuildLock: vi.fn(),
  releaseOutputLock: vi.fn(),
  serve: vi.fn(),
}))

vi.mock('srvx', () => ({ serve }))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxt, buildNuxt }),
}))

vi.mock('../../../src/utils/lockfile', () => ({
  acquireLock,
  acquireOutputLock,
  formatLockError,
}))

let cwd: string

async function runAnalyze({ args = ['--no-serve'], routes = [], vite = {}, devServer = {}, buildAnalyze = {} }: { args?: string[], routes?: string[], vite?: Record<string, any>, devServer?: Record<string, any>, buildAnalyze?: Record<string, any> } = {}) {
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
        build: {
          analyze: { enabled: true, template: 'treemap', filename: join(cwd, 'analyze', '{name}.html'), ...buildAnalyze },
        },
        devServer,
        vite,
      },
    } as unknown as Nuxt)
  })

  buildNuxt.mockImplementation(async (nuxt: Nuxt) => {
    // Stand in for rollup-plugin-visualizer writing the client report
    const { filename, template } = nuxt.options.build.analyze as { filename: string, template: string }
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename.replace('{name}', 'client'), template)
    const nitroHooks = createHooks()
    await nuxtHooks.callHook('nitro:init', { hooks: nitroHooks })
    await nitroHooks.callHook('prerender:routes', prerenderRoutes)
  })

  const renderer = await render(() => runCommand(analyze, { rawArgs: [`--cwd=${cwd}`, ...args] }))

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
    const { prerendered, overrides, output } = await runAnalyze({ args: ['--no-serve', '--prerender'], routes: ['/', '/about'] })
    expect(prerendered).toEqual(['/', '/about'])
    expect(overrides.nitro?.prerender).toBeUndefined()
    expect(output).not.toContain('Skipped prerendering')
  })

  it('should write metadata and fall back to a non-empty slug', async () => {
    await runAnalyze({ args: ['--no-serve', '--name=   '] })

    const meta = JSON.parse(await readFile(join(cwd, 'analyze/default/meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      name: '   ',
      slug: 'default',
      analyzeDir: join(cwd, 'analyze/default'),
      buildDir: join(cwd, '.nuxt'),
      outDir: join(cwd, '.output'),
    })
    expect(meta.endTime).toBeGreaterThanOrEqual(meta.startTime)
  })

  it('should keep the results of each named run', async () => {
    await runAnalyze({ args: ['--no-serve', '--name=before'] })
    await runAnalyze({ args: ['--no-serve', '--name=after/fix'] })

    await expect(readFile(join(cwd, 'analyze/before/client.html'), 'utf8')).resolves.toBe('treemap')
    await expect(readFile(join(cwd, 'analyze/after_fix/client.html'), 'utf8')).resolves.toBe('treemap')
    const meta = JSON.parse(await readFile(join(cwd, 'analyze/before/meta.json'), 'utf8'))
    expect(meta).toMatchObject({ name: 'before', slug: 'before' })
  })

  it('should keep a custom report filename', async () => {
    await runAnalyze({ buildAnalyze: { filename: join(cwd, 'reports/{name}.html') } })
    await expect(readFile(join(cwd, 'reports/client.html'), 'utf8')).resolves.toBe('treemap')
  })

  it('should write the client report as JSON with --json and not serve it', async () => {
    vi.stubEnv('CI', '')
    await runAnalyze({ args: ['--json'] })
    vi.unstubAllEnvs()

    await expect(readFile(join(cwd, 'analyze/default/client.json'), 'utf8')).resolves.toBe('raw-data')
    expect(serve).not.toHaveBeenCalled()
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

  describe('stats server', () => {
    async function statusForHost(vite: Record<string, any>, host: string, devServer: Record<string, any> = {}): Promise<number> {
      vi.stubEnv('CI', '')
      vi.stubEnv('HOST', '')
      serve.mockReturnValue({ ready: () => Promise.resolve() })
      await runAnalyze({ args: [], vite, devServer })
      const { fetch } = serve.mock.calls[0]![0] as { fetch: (request: Request) => Response }
      return fetch(new Request('http://localhost/', { headers: { host } })).status
    }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should reject a host it was not started on', async () => {
      await expect(statusForHost({}, 'rebinding-attacker.com')).resolves.toBe(403)
    })

    it('should allow the hosts in `vite.server.allowedHosts`', async () => {
      const vite = { server: { allowedHosts: ['.example.test'] } }
      await expect(statusForHost(vite, 'app.example.test:3000')).resolves.toBe(200)
      serve.mockClear()
      await expect(statusForHost(vite, 'rebinding-attacker.com')).resolves.toBe(403)
    })

    it('should allow any host for `vite.server.allowedHosts: true`', async () => {
      await expect(statusForHost({ server: { allowedHosts: true } }, 'rebinding-attacker.com')).resolves.toBe(200)
    })

    it('should allow the hosts in `devServer.allowedHosts`', async () => {
      await expect(statusForHost({}, 'app.example.test', { allowedHosts: ['app.example.test'] })).resolves.toBe(200)
    })

    it('should allow any host for `devServer.allowedHosts: true`', async () => {
      await expect(statusForHost({ server: { allowedHosts: ['app.example.test'] } }, 'rebinding-attacker.com', { allowedHosts: true })).resolves.toBe(200)
    })
  })
})
