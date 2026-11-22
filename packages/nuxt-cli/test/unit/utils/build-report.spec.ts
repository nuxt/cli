import type { ServerBuild } from '../../../src/utils/server-build'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BuildProgress } from '../../../src/utils/build-progress'
import { createBuildReport } from '../../../src/utils/build-report'
import { stripAnsi } from '../../../src/utils/formatting'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  isCI: false,
}))
vi.mock('../../../src/utils/logger', () => ({
  logger: { error: mocks.error },
}))
vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  get isCI() { return mocks.isCI },
}))

type Handler = (...args: any[]) => unknown

function createNuxt(rootDir: string) {
  const handlers: Record<string, Handler[]> = {}
  return {
    nuxt: {
      options: { rootDir },
      hook: (name: string, fn: Handler) => void (handlers[name] ||= []).push(fn),
    },
    call: async (name: string, ...args: unknown[]) => {
      for (const fn of handlers[name] || []) {
        await fn(...args)
      }
    },
  }
}

function serverBuild(dir: string, overrides: Partial<ServerBuild> = {}): ServerBuild {
  return {
    label: 'Nitro',
    declared: true,
    hasDevServer: true,
    target: 'node-server',
    dir,
    publicDir: join(dir, 'public'),
    previewCommand: undefined,
    deployCommand: undefined,
    previewStaticDir: undefined,
    ...overrides,
  }
}

let root: string
let cwd: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-build-report-')))
  cwd = process.cwd()
  process.chdir(root)
})
afterEach(async () => {
  process.chdir(cwd)
  vi.clearAllMocks()
  mocks.isCI = false
  await rm(root, { recursive: true, force: true })
})

async function setup(rootDir = root) {
  const { nuxt, call } = createNuxt(rootDir)
  const progress = new BuildProgress()
  const report = createBuildReport(nuxt as any, { progress, command: 'build' })
  return { report, progress, call }
}

async function writeFiles(dir: string, files: Record<string, string>) {
  await mkdir(dir, { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return Object.entries(files).map(([path, content]) => ({
    path,
    size: Buffer.byteLength(content),
  }))
}

const client = { name: 'client', consumer: 'client', builder: 'vite' }
const ssr = { name: 'ssr', consumer: 'server', builder: 'vite' }
const nitro = { name: 'nitro', consumer: 'server', builder: 'rollup' }

describe('createBuildReport', () => {
  it('shows environments with other names verbatim rather than capitalising them', async () => {
    const { report, call } = await setup()
    await call('build:environment:start', { name: 'nuxt_vite_server_cloudflare', consumer: 'server', builder: 'vite' })
    await call('build:environment:done', { name: 'nuxt_vite_server_cloudflare', consumer: 'server', builder: 'vite' }, {
      duration: 384,
      outDir: root,
      files: [
        { path: 'worker.js', size: 584_560 },
      ],
    })

    expect(stripAnsi((await report.summary(false))!)).toBe('nuxt_vite_server_cloudflare (vite) built in 384ms · 584.56 kB')
  })

  it('summarises each bundle in the order they started, with gzip sizes for the client', async () => {
    const { report, call } = await setup()
    const clientDir = join(root, '.output/public')
    const serverDir = join(root, '.output/server')
    const clientFiles = await writeFiles(clientDir, {
      '_nuxt/entry.js': 'a'.repeat(2000),
      '_nuxt/entry.js.map': 'm'.repeat(5000),
    })
    const serverFiles = await writeFiles(serverDir, {
      'index.mjs': 'b'.repeat(3000),
    })

    vi.useFakeTimers({
      now: 0,
      toFake: ['Date'],
    })
    await call('build:environment:start', client)
    vi.setSystemTime(5)
    await call('build:environment:start', ssr)
    await call('build:environment:done', ssr, {
      duration: 200,
      outDir: join(root, '.nuxt/dist/server'),
      files: [
        { path: 'server.mjs', size: 1500 },
      ],
    })
    await call('build:environment:done', client, { duration: 300, outDir: clientDir, files: clientFiles })
    await call('build:environment:start', nitro)
    await call('build:environment:done', nitro, { duration: 100, outDir: serverDir, files: serverFiles })
    vi.useRealTimers()

    const summary = stripAnsi((await report.summary(false))!).split('\n')
    expect(summary).toHaveLength(3)
    expect(summary[0]).toMatch(/^Client \(vite\) built in 300ms · 2\.00 kB \(\d+ B gzip\)$/)
    expect(summary[1]).toBe('Server (vite) built in 200ms · 1.50 kB')
    expect(summary[2]).toBe('Nitro (rollup) built in 100ms · 3.00 kB')
  })

  it('lists the files of each bundle when verbose', async () => {
    const { report, call } = await setup()
    const serverDir = join(root, '.output/server')
    await call('build:environment:start', nitro)
    await call('build:environment:done', nitro, {
      duration: 100,
      outDir: serverDir,
      files: [
        { path: 'index.mjs', size: 3000 },
        { path: 'chunks/a.mjs', size: 12000 },
      ],
    })

    expect(stripAnsi((await report.summary(true))!).split('\n')).toEqual([
      'Nitro (rollup) built in 100ms · 15.00 kB',
      '  .output/server/chunks/a.mjs  12.00 kB',
      '  .output/server/index.mjs      3.00 kB',
    ])
  })

  it('lists the gzip size of each client file when verbose', async () => {
    const { report, call } = await setup()
    const clientDir = join(root, '.output/public')
    const files = await writeFiles(clientDir, {
      'a.js': 'a'.repeat(4000),
      'b.css': 'b'.repeat(1000),
    })
    await call('build:environment:start', client)
    await call('build:environment:done', client, { duration: 10, outDir: clientDir, files })

    const lines = stripAnsi((await report.summary(true))!).split('\n')
    expect(lines[1]).toMatch(/^ {2}\.output\/public\/a\.js {3}4\.00 kB +\d+ B gzip$/)
    expect(lines[2]).toMatch(/^ {2}\.output\/public\/b\.css {2}1\.00 kB +\d+ B gzip$/)
  })

  it('drives the progress line from the bundles and prerendering', async () => {
    const { progress, call } = await setup()
    const seen: string[] = []
    progress.onUpdate(snapshot => seen.push(`${snapshot.message}${snapshot.meter
      ? ` ${snapshot.meter.done}/${snapshot.meter.total}`
      : ''}`))

    await call('build:environment:start', client)
    await call('build:environment:start', ssr)
    await call('build:environment:done', ssr, { duration: 1, outDir: root, files: [] })
    await call('build:environment:done', client, { duration: 1, outDir: root, files: [] })
    await call('build:prerender:start', { routes: 1 })
    await call('build:prerender:route', {
      route: '/',
      duration: 10,
      skipped: false,
      total: 2,
    })
    await call('build:prerender:route', {
      route: '/about',
      duration: 10,
      skipped: false,
      total: 2,
    })
    await call('build:prerender:done', { duration: 10, written: 2, failed: [] })

    expect(seen).toEqual([
      'Loading Nuxt config',
      'Bundling client',
      'Bundling client and server',
      'Bundling client',
      'Building',
      'Prerendering routes 0/1',
      'Prerendering routes 1/2',
      'Prerendering routes 2/2',
      'Building',
    ])
  })

  it('lists the first 20 pages in natural order in a terminal and says how to see the rest', async () => {
    const { report, call } = await setup()
    await call('build:prerender:start', { routes: 27 })
    await call('build:prerender:route', { route: '/page-0/_payload.json?123', duration: 1, skipped: false })
    for (let index = 24; index >= 0; index--) {
      await call('build:prerender:route', { route: `/page-${index}`, duration: 5, skipped: false })
    }
    await call('build:prerender:route', { route: '/skipped', duration: 1, skipped: true })
    await call('build:prerender:done', { duration: 900, written: 26, failed: [] })

    const lines = stripAnsi((await report.summary(false))!).split('\n')
    expect(lines[0]).toBe('Prerendered 26 routes in 900ms')
    expect(lines[1]).toBe('Routes:')
    expect(lines.slice(2, 22)).toEqual(Array.from({ length: 20 }, (_, index) => `/page-${index}`))
    expect(lines.at(-1)).toBe('… and 6 more. Run npx nuxt build --logLevel=verbose to see all prerendered routes.')
    expect(lines).toHaveLength(23)
  })

  it('lists every route in CI, skipped ones too', async () => {
    mocks.isCI = true
    const { report, call } = await setup()
    await call('build:prerender:start', { routes: 2 })
    await call('build:prerender:route', { route: '/', duration: 12, skipped: false })
    await call('build:prerender:route', { route: '/_payload.json?x', duration: 1, skipped: true })
    await call('build:prerender:done', { duration: 50, written: 1, failed: [] })

    expect(stripAnsi((await report.summary(false))!).split('\n')).toEqual([
      'Prerendered 1 route in 50ms',
      '/                    12ms',
      '/_payload.json?x  skipped',
    ])
  })

  it('lists failed prerenders as soon as prerendering is done', async () => {
    const { call } = await setup()
    await call('build:prerender:start', { routes: 2 })
    await call('build:prerender:done', {
      duration: 50,
      written: 0,
      failed: [
        { route: '/missing', status: 404, message: 'Page not found: /missing' },
        { route: '/broken', message: 'Boom' },
      ],
    })

    expect(stripAnsi(mocks.error.mock.calls[0]![0])).toBe('Failed to prerender 2 routes:\n/missing (404 Page not found: /missing)\n/broken (Boom)')
  })

  it('names the pages that link to a failed route, the first few in a terminal', async () => {
    const { call } = await setup()
    const linkedFrom = [
      '/',
      '/about',
      '/blog',
      '/blog/a',
      '/blog/b',
    ]
    await call('build:prerender:start', { routes: 1 })
    await call('build:prerender:done', {
      duration: 50,
      written: 0,
      failed: [
        {
          route: '/missing',
          status: 404,
          message: 'Page not found',
          linkedFrom,
        },
      ],
    })

    expect(stripAnsi(mocks.error.mock.calls[0]![0])).toBe('Failed to prerender 1 route:\n/missing (404 Page not found)\n  linked from /, /about, /blog and 2 more')
  })

  it('names every page that links to a failed route in CI', async () => {
    mocks.isCI = true
    const { call } = await setup()
    await call('build:prerender:start', { routes: 1 })
    await call('build:prerender:done', {
      duration: 50,
      written: 0,
      failed: [
        {
          route: '/missing',
          message: 'Boom',
          linkedFrom: ['/', '/about', '/blog', '/blog/a'],
        },
      ],
    })

    expect(stripAnsi(mocks.error.mock.calls[0]![0])).toBe('Failed to prerender 1 route:\n/missing (Boom)\n  linked from /, /about, /blog, /blog/a')
  })

  it('offers a preview only when a server bundle was written into the output', async () => {
    const { report, call } = await setup()
    const output = join(root, '.output')
    await call('build:environment:start', ssr)
    await call('build:environment:done', ssr, {
      duration: 1,
      outDir: join(root, '.nuxt/dist/server'),
      files: [],
    })
    expect(report.commands(serverBuild(output))).toEqual([])

    await call('build:environment:start', nitro)
    await call('build:environment:done', nitro, {
      duration: 1,
      outDir: join(output, 'server'),
      files: [],
    })
    expect(report.commands(serverBuild(output, { deployCommand: 'npx wrangler --cwd .output deploy' })).map(stripAnsi)).toEqual([
      'You can preview this build using npx nuxt preview',
      'You can deploy this build using npx wrangler --cwd .output deploy',
    ])
  })

  it('runs the deploy command from the project when it is not the current directory', async () => {
    const project = join(root, 'my app')
    const { report } = await setup(project)

    expect(report.staticCommands(serverBuild(join(project, '.output'), { target: 'vercel-static', deployCommand: 'npx vercel deploy --prebuilt' })).map(stripAnsi)).toEqual([
      'You can deploy this build using cd "my app" && npx vercel deploy --prebuilt',
    ])
  })

  it('points a prerendered build at a static host, its deploy command or its target', async () => {
    const { report } = await setup()
    const output = join(root, '.output')

    expect(report.staticCommands(serverBuild(output, { target: 'static' })).map(stripAnsi)).toEqual(['You can now deploy .output/public to any static hosting'])
    expect(report.staticCommands(serverBuild(output, { target: 'vercel-static', deployCommand: 'npx vercel deploy --prebuilt' })).map(stripAnsi)).toEqual(['You can deploy this build using npx vercel deploy --prebuilt'])
    expect(report.staticCommands(serverBuild(output, { target: 'netlify-static' })).map(stripAnsi)).toEqual(['You can now deploy .output to netlify-static'])
  })

  it('prints nothing when Nuxt reports no bundles', async () => {
    const { report } = await setup()
    expect(await report.summary(false)).toBeUndefined()
  })
})
