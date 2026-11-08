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

describe('quietServerOutput', () => {
  it('drops Nitro and the Vite server bundle to warnings only', async () => {
    const { nuxt, hooks } = createNuxt()
    quietServerOutput(nuxt as any)

    const nitroConfig = { logLevel: 3 }
    await hooks.call('nitro:config', nitroConfig)
    const serverConfig = { logLevel: 'info' }
    const clientConfig = { logLevel: 'info' }
    await hooks.call('vite:extendConfig', serverConfig, { isServer: true, isClient: false })
    await hooks.call('vite:extendConfig', clientConfig, { isServer: false, isClient: true })

    expect(nitroConfig.logLevel).toBe(1)
    expect(serverConfig.logLevel).toBe('warn')
    expect(clientConfig.logLevel).toBe('info')
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
    expect(verbose.hooks.has('vite:extendConfig')).toBe(false)
    expect(configured.hooks.has('vite:extendConfig')).toBe(false)
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
    await hooks.call('nitro:init', nitro)
    await hooks.call('nitro:build:before', nitro)
    await nitroHooks.call('prerender:route', { route: '/' })
    await nitroHooks.call('prerender:route', { route: '/gone', error: { statusCode: 404 } })
    await nitroHooks.call('prerender:done', { failedRoutes: [{ route: '/gone', error: { statusCode: 404, statusMessage: 'Not Found' } }] })
    await nitroHooks.call('rollup:before', nitro)
    await nitroHooks.call('compiled', nitro)

    const lines = stripAnsi(report.summary()!).split('\n')
    expect(lines[0]).toMatch(/^Prerendered 1 route in \S+$/)
    // Source maps are left out, as Nitro leaves them out of its own total.
    expect(lines[1]).toMatch(/^Server \(nitro\) built in \S+ · 2\.50 kB$/)
    expect(lines[2]).toMatch(/^Preview: node \S*server\/index\.mjs$/)
    expect(stripAnsi(mocks.error.mock.calls[0]![0])).toBe('Failed to prerender 1 route:\n  /gone (404 Not Found)')
  })

  it('reports nothing about a server for a static build', async () => {
    const { nuxt, hooks } = createNuxt()
    const report = quietServerOutput(nuxt as any)
    const nitroHooks = createHooks()
    const nitro = { options: { static: true, output: { serverDir: '/missing' } }, hooks: nitroHooks }
    await hooks.call('nitro:init', nitro)
    await nitroHooks.call('compiled', nitro)

    expect(report.summary()).toBeUndefined()
  })
})

describe('formatBytes', () => {
  it('uses decimal units like Vite and Nitro', () => {
    expect([formatBytes(999), formatBytes(1000), formatBytes(2_454_000)]).toEqual(['999 B', '1.00 kB', '2.45 MB'])
  })
})
