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

function fakeVisualizer(options: Record<string, any>) {
  return { name: 'visualizer', options }
}

// A stand-in `rollup-plugin-visualizer`, installed in the project for the CLI to find
async function installFakeVisualizer() {
  const dir = join(cwd, 'node_modules/rollup-plugin-visualizer')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'rollup-plugin-visualizer', type: 'module', exports: './index.js' }))
  await writeFile(join(dir, 'index.js'), `export const visualizer = options => ({ name: 'visualizer', options })`)
}

async function runAnalyze({ args = ['--no-serve'], routes = [], vite = {}, devServer = {}, buildAnalyze = {}, nitroAnalyze = {}, devtools = {}, nitro = 'v2' }: { args?: string[], routes?: string[], vite?: Record<string, any>, devServer?: Record<string, any>, buildAnalyze?: Record<string, any>, nitroAnalyze?: Record<string, any>, devtools?: boolean | Record<string, any>, nitro?: 'v2' | 'v3' } = {}) {
  const nuxtHooks = createHooks()
  const prerenderRoutes = new Set(routes)
  let overrides: Record<string, any> = {}
  const nuxtOptions = {
    analyzeDir: join(cwd, 'analyze'),
    buildDir: join(cwd, '.nuxt'),
    rootDir: cwd,
    modulesDir: [join(cwd, 'node_modules')],
    nitro: {},
    build: {
      analyze: { enabled: true, template: 'treemap', filename: join(cwd, 'analyze', '{name}.html'), ...buildAnalyze },
    },
    devServer,
    devtools,
    vite,
  }

  // Nuxt 4 passes default analyze options to Nitro v2; Nuxt 5 (Nitro v3) has none
  const nitroConfig: { analyze?: Record<string, string> } = {}
  const nitroHooks = createHooks()

  loadNuxt.mockImplementation((options: { overrides: Record<string, any> }) => {
    overrides = options.overrides
    return Promise.resolve({
      ...nuxtHooks,
      // Nuxt creates Nitro while getting ready, before the build
      ready: async () => {
        if (nitro === 'v2') {
          nitroConfig.analyze = { template: 'treemap', filename: join(nuxtOptions.analyzeDir, '{name}.html'), ...nitroAnalyze }
        }
        await nuxtHooks.callHook('nitro:config', nitroConfig)
        await nuxtHooks.callHook('nitro:init', { hooks: nitroHooks })
      },
      options: nuxtOptions,
    } as unknown as Nuxt)
  })

  buildNuxt.mockImplementation(async (nuxt: Nuxt) => {
    // Stand in for rollup-plugin-visualizer writing the client report
    const { filename, template } = nuxt.options.build.analyze as { filename: string, template: string }
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename.replace('{name}', 'client'), template)
    // Nitro v2 adds the visualizer from its `analyze` option before `rollup:before`
    const bundlerConfig: { plugins: any[] } = {
      plugins: nitroConfig.analyze ? [fakeVisualizer({ ...nitroConfig.analyze, filename: nitroConfig.analyze.filename!.replace('{name}', 'nitro') })] : [],
    }
    await nitroHooks.callHook('rollup:before', {}, bundlerConfig)
    // Stand in for the visualizer writing the server report
    for (const plugin of bundlerConfig.plugins.filter(plugin => plugin.name === 'visualizer')) {
      await mkdir(dirname(plugin.options.filename), { recursive: true })
      await writeFile(plugin.options.filename, plugin.options.template)
    }
    await nitroHooks.callHook('prerender:routes', prerenderRoutes)
  })

  const renderer = await render(() => runCommand(analyze, { rawArgs: [`--cwd=${cwd}`, ...args] }))

  const ignore: ((path: string) => unknown)[] = overrides.nitro?.prerender?.ignore || []
  return {
    output: screen(renderer),
    nuxtOptions,
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

  it('should not let webpack-bundle-analyzer open a browser', async () => {
    const { overrides } = await runAnalyze()
    expect(overrides.webpack.analyze.openAnalyzer).toBe(false)
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
    await expect(readFile(join(cwd, 'analyze/default/nitro.json'), 'utf8')).resolves.toBe('raw-data')
    expect(serve).not.toHaveBeenCalled()
  })

  it('should write the Nitro report as HTML without --json', async () => {
    await runAnalyze()
    await expect(readFile(join(cwd, 'analyze/default/nitro.html'), 'utf8')).resolves.toBe('treemap')
  })

  describe('nitro v3', () => {
    it('should add the Nitro report itself', async () => {
      await installFakeVisualizer()
      await runAnalyze({ nitro: 'v3' })
      await expect(readFile(join(cwd, 'analyze/default/nitro.html'), 'utf8')).resolves.toBe('treemap')
    })

    it('should write the Nitro report as JSON with --json', async () => {
      await installFakeVisualizer()
      await runAnalyze({ args: ['--json'], nitro: 'v3' })
      await expect(readFile(join(cwd, 'analyze/default/nitro.json'), 'utf8')).resolves.toBe('raw-data')
    })

    it('should tell how to install rollup-plugin-visualizer as a dev dependency', async () => {
      const { output } = await runAnalyze({ nitro: 'v3' })
      expect(output).toContain('Install rollup-plugin-visualizer as a dev dependency to analyze the Nitro server bundle')
      expect(output).toMatch(/-D rollup-plugin-visualizer/)
    })
  })

  it('should not add a second Nitro report when Nitro made one', async () => {
    await installFakeVisualizer()
    const { output } = await runAnalyze({ nitroAnalyze: { filename: join(cwd, 'reports/{name}.html') } })
    await expect(readFile(join(cwd, 'reports/nitro.html'), 'utf8')).resolves.toBe('treemap')
    await expect(readFile(join(cwd, 'analyze/default/nitro.html'), 'utf8')).rejects.toThrow()
    expect(output).not.toContain('rollup-plugin-visualizer')
  })

  it('should disable the DevTools Vite inspect output with --json', async () => {
    const { nuxtOptions, overrides } = await runAnalyze({ args: ['--json'], devtools: { componentInspector: false } })
    expect(nuxtOptions.devtools).toEqual({ componentInspector: false, viteInspect: false })
    expect(overrides.devtools).toBeUndefined()
  })

  it('should keep the DevTools enabled choice with --json', async () => {
    const { nuxtOptions } = await runAnalyze({ args: ['--json'], devtools: false })
    expect(nuxtOptions.devtools).toEqual({ enabled: false, viteInspect: false })
  })

  it('should leave DevTools options alone without --json', async () => {
    const { nuxtOptions } = await runAnalyze({ devtools: true })
    expect(nuxtOptions.devtools).toBe(true)
  })

  it('should keep a custom Nitro report filename with --json', async () => {
    await runAnalyze({ args: ['--json'], nitroAnalyze: { filename: join(cwd, 'reports/{name}.data') } })
    await expect(readFile(join(cwd, 'reports/nitro.data'), 'utf8')).resolves.toBe('raw-data')
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

    /** Run the analysis and return a way to request pages from its stats server. */
    async function startStatsServer(options: Parameters<typeof runAnalyze>[0] = {}): Promise<(path: string) => Response> {
      vi.stubEnv('CI', '')
      vi.stubEnv('HOST', '')
      serve.mockReturnValue({ ready: () => Promise.resolve() })
      await runAnalyze({ ...options, args: [] })
      const { fetch } = serve.mock.calls[0]![0] as { fetch: (request: Request) => Response }
      return path => fetch(new Request(`http://localhost${path}`))
    }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should link to each generated report', async () => {
      const fetchPage = await startStatsServer()
      const html = await fetchPage('/').text()
      expect(html).toContain('<a href="/nitro">')
      expect(html).toContain('<a href="/client">')
    })

    it('should serve the client report at / when it is the only report', async () => {
      // Nitro v3 without rollup-plugin-visualizer installed: only the client report is written
      const fetchPage = await startStatsServer({ nitro: 'v3', buildAnalyze: { template: 'client report' } })
      await expect(fetchPage('/').text()).resolves.toBe('client report')
      await expect(fetchPage('/client').text()).resolves.toBe('client report')
      expect(fetchPage('/nitro').status).toBe(404)
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
