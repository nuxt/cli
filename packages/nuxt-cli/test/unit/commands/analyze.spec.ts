import type { Nuxt } from '@nuxt/schema'

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { runCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
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

const { acquireLock, acquireOutputLock, buildNuxt, formatLockError, getPort, loadNuxt, releaseBuildLock, releaseOutputLock, serve } = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  formatLockError: vi.fn(() => 'locked'),
  acquireOutputLock: vi.fn(),
  buildNuxt: vi.fn(),
  getPort: vi.fn(),
  loadNuxt: vi.fn(),
  releaseBuildLock: vi.fn(),
  releaseOutputLock: vi.fn(),
  serve: vi.fn(),
}))

vi.mock('srvx', () => ({ serve }))

vi.mock('get-port-please', () => ({ getPort }))

vi.mock('exsolve', async (importOriginal) => {
  const exsolve = await importOriginal<typeof import('exsolve')>()
  return { ...exsolve, resolveModulePath: vi.fn(exsolve.resolveModulePath) }
})

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

async function installFakeVisualizer() {
  const dir = join(cwd, 'node_modules/rollup-plugin-visualizer')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'rollup-plugin-visualizer', type: 'module', exports: './index.js' }))
  await writeFile(join(dir, 'index.js'), `export const visualizer = options => ({ name: 'visualizer', options })`)
}

async function runAnalyze({ args = ['--no-serve'], routes = [], vite = {}, devServer = {}, buildAnalyze = {}, webpackAnalyze = {}, nitroAnalyze = {}, devtools = {}, nitro = 'v2' }: { args?: string[], routes?: string[], vite?: Record<string, any>, devServer?: Record<string, any>, buildAnalyze?: Record<string, any>, webpackAnalyze?: Record<string, any>, nitroAnalyze?: false | Record<string, any>, devtools?: boolean | Record<string, any>, nitro?: 'v2' | 'v3' } = {}) {
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
    webpack: {
      analyze: { enabled: true, template: 'treemap', filename: join(cwd, 'analyze', '{name}.html'), ...webpackAnalyze } as Record<string, any>,
    },
    devServer,
    devtools,
    vite,
  }

  // Nuxt 4 passes default analyze options to Nitro v2; Nuxt 5 (Nitro v3) has none
  const nitroConfig: { analyze?: false | Record<string, string> } = {}
  const nitroHooks = createHooks()

  loadNuxt.mockImplementation((options: { overrides: Record<string, any> }) => {
    overrides = options.overrides
    return Promise.resolve({
      ...nuxtHooks,
      ready: async () => {
        if (nitro === 'v2') {
          nitroConfig.analyze = nitroAnalyze && { template: 'treemap', filename: join(nuxtOptions.analyzeDir, '{name}.html'), ...nitroAnalyze }
        }
        await nuxtHooks.callHook('nitro:config', nitroConfig)
        await nuxtHooks.callHook('nitro:init', { hooks: nitroHooks })
      },
      options: nuxtOptions,
    } as unknown as Nuxt)
  })

  buildNuxt.mockImplementation(async (nuxt: Nuxt) => {
    const { filename, template } = nuxt.options.build.analyze as { filename: string, template: string }
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename.replace('{name}', 'client'), template)
    const bundlerConfig: { plugins: any[] } = {
      plugins: nitroConfig.analyze ? [fakeVisualizer({ ...nitroConfig.analyze, filename: nitroConfig.analyze.filename!.replace('{name}', 'nitro') })] : [],
    }
    await nitroHooks.callHook('rollup:before', {}, bundlerConfig)
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
    getPort.mockImplementation((options: { port: number }) => Promise.resolve(options.port))
    acquireLock.mockReturnValue({ release: releaseBuildLock })
    acquireOutputLock.mockReturnValue({ release: releaseOutputLock })
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-analyze-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  describe('webpack', () => {
    it('should not let webpack-bundle-analyzer open a browser', async () => {
      const { nuxtOptions } = await runAnalyze()
      expect(nuxtOptions.webpack.analyze).toMatchObject({ openAnalyzer: false })
      expect(nuxtOptions.webpack.analyze).not.toHaveProperty('analyzerMode')
    })

    it('should only write the webpack stats file with --json', async () => {
      const { nuxtOptions } = await runAnalyze({ args: ['--json'] })
      expect(nuxtOptions.webpack.analyze).toMatchObject({ openAnalyzer: false, analyzerMode: 'disabled', generateStatsFile: true })
    })

    it('should leave webpack analysis off when it is disabled', async () => {
      const { nuxtOptions, overrides } = await runAnalyze({ args: ['--json'], webpackAnalyze: { enabled: false } })
      expect(overrides.webpack).toBeUndefined()
      expect(nuxtOptions.webpack.analyze).toMatchObject({ enabled: false })
      expect(nuxtOptions.webpack.analyze).not.toHaveProperty('openAnalyzer')
      expect(nuxtOptions.webpack.analyze).not.toHaveProperty('analyzerMode')
      expect(nuxtOptions.webpack.analyze).not.toHaveProperty('generateStatsFile')
    })
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
    await writeFile(join(cwd, 'analyze/after_fix/stale.html'), 'old')
    await runAnalyze({ args: ['--no-serve', '--name=after/fix'] })

    await expect(access(join(cwd, 'analyze/after_fix/stale.html'))).rejects.toThrow()

    await expect(readFile(join(cwd, 'analyze/before/client.html'), 'utf8')).resolves.toBe('treemap')
    await expect(readFile(join(cwd, 'analyze/after_fix/client.html'), 'utf8')).resolves.toBe('treemap')
    const meta = JSON.parse(await readFile(join(cwd, 'analyze/before/meta.json'), 'utf8'))
    expect(meta).toMatchObject({ name: 'before', slug: 'before' })
  })

  it('should remove reports left at the root of the analyze directory', async () => {
    await mkdir(join(cwd, 'analyze/.vite-inspect'), { recursive: true })
    await mkdir(join(cwd, 'analyze/before'), { recursive: true })
    await writeFile(join(cwd, 'analyze/client.html'), 'old')
    await writeFile(join(cwd, 'analyze/meta.json'), '{}')
    await writeFile(join(cwd, 'analyze/before/meta.json'), '{}')

    await runAnalyze()

    await expect(readFile(join(cwd, 'analyze/client.html'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(cwd, 'analyze/meta.json'), 'utf8')).rejects.toThrow()
    await expect(access(join(cwd, 'analyze/.vite-inspect'))).rejects.toThrow()
    await expect(readFile(join(cwd, 'analyze/before/meta.json'), 'utf8')).resolves.toBe('{}')
  })

  it('should keep a custom report filename', async () => {
    await runAnalyze({ args: ['--no-serve', '--name=custom'], buildAnalyze: { filename: join(cwd, 'reports/{name}.html') } })
    await expect(readFile(join(cwd, 'reports/client.html'), 'utf8')).resolves.toBe('treemap')
    await expect(access(join(cwd, 'analyze/custom/client.html'))).rejects.toThrow()
    await expect(readFile(join(cwd, 'analyze/custom/meta.json'), 'utf8')).resolves.toContain('"slug": "custom"')
  })

  it('should use a .json extension for a custom report filename with --json', async () => {
    await runAnalyze({ args: ['--json'], buildAnalyze: { filename: join(cwd, 'reports/{name}.html') }, nitroAnalyze: { filename: join(cwd, 'reports/{name}.html') } })
    await expect(readFile(join(cwd, 'reports/client.json'), 'utf8')).resolves.toBe('raw-data')
    await expect(readFile(join(cwd, 'reports/nitro.json'), 'utf8')).resolves.toBe('raw-data')
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
  })

  it('should not add a second Nitro report when Nitro made one', async () => {
    await installFakeVisualizer()
    await runAnalyze({ nitroAnalyze: { filename: join(cwd, 'reports/{name}.html') } })
    await expect(readFile(join(cwd, 'reports/nitro.html'), 'utf8')).resolves.toBe('treemap')
    await expect(readFile(join(cwd, 'analyze/default/nitro.html'), 'utf8')).rejects.toThrow()
  })

  it('should not add a Nitro report when `nitro.analyze` is disabled', async () => {
    await installFakeVisualizer()
    await runAnalyze({ nitroAnalyze: false })
    await expect(readFile(join(cwd, 'analyze/default/nitro.html'), 'utf8')).rejects.toThrow()
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

    it('should listen on another port when the requested one is in use', async () => {
      vi.stubEnv('PORT', '3000')
      getPort.mockResolvedValue(3001)
      serve.mockReturnValue({ ready: () => Promise.resolve() })
      vi.stubEnv('CI', '')
      vi.stubEnv('HOST', '')

      const { output } = await runAnalyze({ args: [] })

      expect(getPort).toHaveBeenCalledWith(expect.objectContaining({ port: 3000, host: 'localhost' }))
      expect(serve).toHaveBeenCalledWith(expect.objectContaining({ port: 3001 }))
      expect(output).toContain('Port 3000 is in use, using port 3001 instead.')
    })

    it('should link to each generated report', async () => {
      const fetchPage = await startStatsServer()
      const html = await fetchPage('/').text()
      expect(html).toContain('<a href="/nitro">')
      expect(html).toContain('<a href="/client">')
    })

    it('should serve the client report at / when it is the only report', async () => {
      vi.mocked(resolveModulePath).mockReturnValueOnce(undefined)
      const fetchPage = await startStatsServer({ nitro: 'v3', buildAnalyze: { template: 'client report' } })
      await expect(fetchPage('/').text()).resolves.toBe('client report')
      await expect(fetchPage('/client').text()).resolves.toBe('client report')
      expect(fetchPage('/nitro').status).toBe(404)
    })

    it('should serve the client report from a custom report filename', async () => {
      const fetchPage = await startStatsServer({ buildAnalyze: { template: 'client report', filename: join(cwd, 'reports/{name}.html') } })
      await expect(fetchPage('/client').text()).resolves.toBe('client report')
      expect(await fetchPage('/').text()).toContain('<a href="/client">')
    })

    it('should serve the Nitro report from a custom report filename', async () => {
      const fetchPage = await startStatsServer({ nitroAnalyze: { template: 'nitro report', filename: join(cwd, 'reports/{name}.html') } })
      await expect(fetchPage('/nitro').text()).resolves.toBe('nitro report')
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
