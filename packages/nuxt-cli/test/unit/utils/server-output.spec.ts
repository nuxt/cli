import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatBytes, stripAnsi } from '../../../src/utils/formatting'
import { quietServerOutput } from '../../../src/utils/server-output'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: mocks.error } }))

type Handler = (...args: any[]) => unknown

function createHooks() {
  const handlers: Record<string, Handler[]> = {}
  return {
    hook: (name: string, fn: Handler) => void (handlers[name] ||= []).push(fn),
    call: async (name: string, ...args: unknown[]) => {
      for (const fn of handlers[name] || []) {
        await fn(...args)
      }
    },
    has: (name: string) => !!handlers[name]?.length,
  }
}

function createNuxt(options: Record<string, any> = {}) {
  const hooks = createHooks()
  return { nuxt: { options: { logLevel: 'info', nitro: {}, vite: {}, experimental: {}, ...options }, hook: hooks.hook }, hooks }
}

let dir: string | undefined
afterEach(async () => {
  vi.clearAllMocks()
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
})

/** Run `vite:extendConfig` and resolve the plugin the CLI added, against a logger that records what it lets through. */
async function resolveVitePlugin(hooks: ReturnType<typeof createHooks>) {
  const config = { plugins: [] as any[] }
  await hooks.call('vite:extendConfig', config, { isClient: true, isServer: false })
  const plugin = config.plugins[0]
  const printed: string[] = []
  const logger = { info: (message: string) => void printed.push(message) }
  plugin.configResolved({ logger, environments: { client: { consumer: 'client' }, ssr: { consumer: 'server' }, nitro: { consumer: 'server' } } })
  return { plugin, logger, printed }
}

describe('quietServerOutput', () => {
  it('drops Nitro to warnings only', async () => {
    const { nuxt, hooks } = createNuxt()
    quietServerOutput(nuxt as any)

    const nitroConfig = { logLevel: 3 }
    await hooks.call('nitro:config', nitroConfig)

    expect(nitroConfig.logLevel).toBe(1)
  })

  it('keeps Vite\'s output for the client environment only', async () => {
    const { nuxt, hooks } = createNuxt()
    quietServerOutput(nuxt as any)
    const { plugin, logger, printed } = await resolveVitePlugin(hooks)

    // Vite announces each environment before its plugins start.
    logger.info('\u001B[36mvite v8.3.5 \u001B[32mbuilding client environment for production...\u001B[39m')
    plugin.buildStart.call({ environment: { name: 'client', config: { consumer: 'client' } } })
    logger.info('.output/public/_nuxt/entry.js')
    logger.info('vite v8.3.5 building ssr environment for production...')
    plugin.buildStart.call({ environment: { name: 'ssr', config: { consumer: 'server' } } })
    logger.info('.nuxt/vite/services/ssr/server.mjs')
    logger.info('vite v8.3.5 building nitro environment for production...')
    logger.info('.output/server/index.mjs')

    expect(printed.map(line => stripAnsi(line))).toEqual([
      'vite v8.3.5 building client environment for production...',
      '.output/public/_nuxt/entry.js',
    ])
  })

  it('reports each Vite environment as it starts building, before Vite 6 too', async () => {
    const { nuxt, hooks } = createNuxt()
    const started: unknown[] = []
    quietServerOutput(nuxt as any, { onEnvironment: environment => void started.push(environment) })
    const { plugin } = await resolveVitePlugin(hooks)
    plugin.buildStart.call({ environment: { name: 'nitro', config: { consumer: 'server' } } })

    const legacy = { plugins: [] as any[] }
    await hooks.call('vite:extendConfig', legacy, { isClient: false, isServer: true })
    legacy.plugins[0].configResolved({ logger: { info: () => {} }, build: { ssr: true } })
    legacy.plugins[0].buildStart.call({})

    expect(started).toEqual([{ name: 'nitro', consumer: 'server' }, { name: undefined, consumer: 'server' }])
  })

  it('leaves log levels alone when verbose or set by the project', async () => {
    const verbose = createNuxt({ logLevel: 'verbose' })
    quietServerOutput(verbose.nuxt as any)
    const silent = createNuxt({ logLevel: 'silent' })
    quietServerOutput(silent.nuxt as any)
    const configured = createNuxt({ nitro: { logLevel: 3 }, vite: { $server: { logLevel: 'info' } } })
    quietServerOutput(configured.nuxt as any)

    const verboseConfig = { logLevel: 3 }
    await verbose.hooks.call('nitro:config', verboseConfig)
    const silentConfig = { logLevel: 0 }
    await silent.hooks.call('nitro:config', silentConfig)
    const configuredConfig = { logLevel: 3 }
    await configured.hooks.call('nitro:config', configuredConfig)

    expect([verboseConfig.logLevel, silentConfig.logLevel, configuredConfig.logLevel]).toEqual([3, 0, 3])
    for (const { hooks } of [verbose, configured]) {
      const { logger, printed } = await resolveVitePlugin(hooks)
      logger.info('vite v8.3.5 building ssr environment for production...')
      logger.info('.nuxt/vite/services/ssr/server.mjs')
      expect(printed).toHaveLength(2)
    }
  })

  it('summarises the server build and lists failed prerenders', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxi-server-output-'))
    const serverDir = join(dir, 'server')
    await mkdir(join(serverDir, 'chunks'), { recursive: true })
    await writeFile(join(serverDir, 'index.mjs'), 'x'.repeat(1500))
    await writeFile(join(serverDir, 'chunks/app.mjs'), 'x'.repeat(1000))
    await writeFile(join(serverDir, 'chunks/app.mjs.map'), 'x'.repeat(50_000))

    const { nuxt, hooks } = createNuxt()
    const report = quietServerOutput(nuxt as any)
    const nitroHooks = createHooks()
    const nitro = {
      options: { output: { serverDir, dir }, commands: { preview: 'node {{ output.serverDir }}/index.mjs' } },
      hooks: nitroHooks,
    }
    await hooks.call('nitro:config', { logLevel: 3 })
    await hooks.call('nitro:init', nitro)
    await nitroHooks.call('prerender:route', { route: '/' })
    await nitroHooks.call('prerender:route', { route: '/feed', skip: true })
    await nitroHooks.call('prerender:route', { route: '/gone', error: { statusCode: 404 } })
    // Nitro 2 and Nitro 3 name the HTTP status differently.
    await nitroHooks.call('prerender:done', { failedRoutes: [
      { route: '/gone', error: { statusCode: 404, statusMessage: 'Not Found' } },
      { route: '/broken', error: { status: 500, statusText: 'Server Error' } },
    ] })
    await nitroHooks.call('compiled', nitro)

    const timings = [
      { phase: 'bundle (server)', message: '', duration: 300 },
      { phase: 'prerender', message: '', duration: 1200 },
      { phase: 'bundle (nitro)', message: '', duration: 2500 },
    ]
    const lines = stripAnsi(report.summary(timings)!).split('\n')
    expect(lines[0]).toBe('Prerendered 1 route in 1.20s')
    // Source maps are left out, as Nitro leaves them out of its own total.
    expect(lines[1]).toBe('Server (nitro) built in 2.50s · 2.50 kB')
    expect(lines).toHaveLength(2)
    expect(report.commands().map(stripAnsi)).toEqual(['You can preview this build using npx nuxt preview'])
    expect(stripAnsi(mocks.error.mock.calls[0]![0])).toBe('Failed to prerender 2 routes:\n  /gone (404 Not Found)\n  /broken (500 Server Error)')
  })

  it('leaves failed prerenders to Nitro when the project sets its log level', async () => {
    const { nuxt, hooks } = createNuxt({ nitro: { logLevel: 3 } })
    quietServerOutput(nuxt as any)
    const nitroHooks = createHooks()
    await hooks.call('nitro:config', { logLevel: 3 })
    await hooks.call('nitro:init', { options: { output: { serverDir: '/missing' } }, hooks: nitroHooks })
    await nitroHooks.call('prerender:done', { failedRoutes: [{ route: '/gone', error: { statusCode: 404 } }] })

    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('reports a server built by Vite when Nitro is not the server builder', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxi-server-output-'))
    await mkdir(join(dir, 'server'), { recursive: true })
    await writeFile(join(dir, 'server/index.mjs'), 'x'.repeat(1200))
    await writeFile(join(dir, 'server/index.mjs.map.json'), 'x'.repeat(40_000))

    const { nuxt, hooks } = createNuxt()
    Object.assign(nuxt, { serverBuild: { name: 'vite', output: { dir: () => dir } } })
    const report = quietServerOutput(nuxt as any)
    const { plugin } = await resolveVitePlugin(hooks)
    plugin.buildStart.call({ environment: { name: 'client', config: { consumer: 'client' } } })
    plugin.buildStart.call({ environment: { name: 'ssr', config: { consumer: 'server' } } })
    await hooks.call('build:done')

    const timings = [{ phase: 'bundle (client)', message: '', duration: 900 }, { phase: 'bundle (server)', message: '', duration: 400 }]
    expect(stripAnsi(report.summary(timings)!).split('\n')).toEqual([
      'Server (vite) built in 400ms · 1.20 kB',
    ])
    expect(report.commands().map(stripAnsi)).toEqual(['You can preview this build using npx nuxt preview'])
  })

  it('reports nothing about a server for a static build', async () => {
    const { nuxt, hooks } = createNuxt()
    const report = quietServerOutput(nuxt as any)
    const nitroHooks = createHooks()
    const nitro = { options: { static: true, output: { serverDir: '/missing' } }, hooks: nitroHooks }
    await hooks.call('nitro:init', nitro)
    await nitroHooks.call('compiled', nitro)

    expect(report.summary([{ phase: 'bundle (nitro)', message: '', duration: 100 }])).toBeUndefined()
    expect(report.commands()).toEqual([])
  })
})

describe('formatBytes', () => {
  it('uses decimal units like Vite and Nitro', () => {
    expect([formatBytes(999), formatBytes(1000), formatBytes(2_454_000)]).toEqual(['999 B', '1.00 kB', '2.45 MB'])
  })
})
