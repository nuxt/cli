import type { AddressInfo } from 'node:net'

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { buildNuxt, diffNuxtConfig, loadNuxt, loadNuxtConfig, writeTypes } = vi.hoisted(() => ({
  buildNuxt: vi.fn(),
  diffNuxtConfig: vi.fn(),
  loadNuxt: vi.fn(),
  loadNuxtConfig: vi.fn(),
  writeTypes: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ buildNuxt, diffNuxtConfig, loadNuxt, loadNuxtConfig, writeTypes }),
  tryResolveNuxt: () => undefined,
}))

const { NuxtDevServer } = await import('../../../src/dev/utils')

type Hook = (...args: any[]) => unknown

interface FakeNuxt {
  options: Record<string, any>
  callHook: (name: string, ...args: unknown[]) => Promise<void>
  hook: (name: string, fn: Hook) => void
  hooks: {
    hook: (name: string, fn: Hook) => void
    hookOnce: (name: string, fn: Hook) => void
    callHook: (name: string, ...args: unknown[]) => Promise<void>
  }
  ready: () => Promise<void>
  close: () => Promise<void>
  server: { handler: (req: unknown, res: any) => void }
}

let cwd: string
const tempDirs: string[] = []
const servers: InstanceType<typeof NuxtDevServer>[] = []

function createNuxt(overrides: Record<string, any> = {}): FakeNuxt {
  const hooks = new Map<string, Hook[]>()
  const callHook = async (name: string, ...args: unknown[]) => {
    for (const fn of hooks.get(name) || []) {
      await fn(...args)
    }
  }
  return {
    callHook,
    options: {
      buildDir: join(cwd, '.nuxt'),
      rootDir: cwd,
      app: { baseURL: '/', buildAssetsDir: '/_nuxt/' },
      devServer: {},
      vite: {},
      _layers: [],
      ...overrides,
    },
    hook: (name, fn) => void hooks.set(name, [...hooks.get(name) || [], fn]),
    hooks: {
      hook: (name, fn) => void hooks.set(name, [...hooks.get(name) || [], fn]),
      hookOnce: (name, fn) => void hooks.set(name, [...hooks.get(name) || [], fn]),
      callHook,
    },
    ready: () => Promise.resolve(),
    close: () => Promise.resolve(),
    server: {
      handler: (_req, res) => {
        res.statusCode = 200
        res.end('app')
      },
    },
  }
}

function createServer(options: Record<string, any> = {}) {
  const server = new NuxtDevServer({
    cwd,
    dotenv: {},
    overrides: {},
    listenOverrides: { hostname: '127.0.0.1', port: 0, showURL: false, qr: false },
    ...options,
  })
  servers.push(server)
  return server
}

async function get(server: InstanceType<typeof NuxtDevServer>, path = '/'): Promise<{ status: number, body: string }> {
  const { port } = server.listener.address as AddressInfo
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: response.status, body: await response.text() }
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nuxt-dev-lifecycle-'))
  tempDirs.push(dir)
  return dir
}

beforeEach(async () => {
  cwd = await makeTempDir()
  loadNuxt.mockReset()
  buildNuxt.mockReset()
  writeTypes.mockReset()
  loadNuxt.mockImplementation(() => Promise.resolve(createNuxt()))
  buildNuxt.mockResolvedValue(undefined)
  writeTypes.mockResolvedValue(undefined)
  diffNuxtConfig.mockReset()
  loadNuxtConfig.mockReset()
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeWatchers()
    server.releaseLock()
    await server.listener?.close().catch(() => {})
    await server.close().catch(() => {})
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('dev server startup', () => {
  it('should serve the app once it is ready', async () => {
    const server = createServer()
    const ready = new Promise<string>(resolve => server.once('ready', resolve))

    await server.init()

    await expect(ready).resolves.toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await expect(get(server)).resolves.toMatchObject({ status: 200, body: 'app' })
  })

  it('should record the listening address in the lock file', async () => {
    const server = createServer()

    await server.init()

    const lock = JSON.parse(readFileSync(join(cwd, '.nuxt', 'nuxt.lock'), 'utf8'))
    expect(lock).toMatchObject({
      command: 'dev',
      cwd,
      pid: process.pid,
      port: (server.listener.address as AddressInfo).port,
    })
    expect(lock.url).toBe(server.listener.url.replace(/\/$/, ''))
  })

  it('should remove the lock when the server releases it', async () => {
    const server = createServer()
    await server.init()

    server.releaseLock()

    expect(existsSync(join(cwd, '.nuxt', 'nuxt.lock'))).toBe(false)
  })

  it('should refuse to start when another process holds the lock', async () => {
    const { acquireLock } = await import('../../../src/utils/lockfile')
    const held = acquireLock(join(cwd, '.nuxt'), { command: 'dev', cwd })
    expect(held.release).toBeTypeOf('function')
    const lockPath = join(cwd, '.nuxt', 'nuxt.lock')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(lockPath, JSON.stringify({
      ...JSON.parse(readFileSync(lockPath, 'utf8')),
      pid: process.ppid,
    }))

    const server = createServer()

    await expect(server.init()).rejects.toThrow('Another Nuxt dev server is already running')
  })

  it('should build types and the app before serving', async () => {
    const server = createServer()

    await server.init()

    expect(writeTypes).toHaveBeenCalledTimes(1)
    expect(buildNuxt).toHaveBeenCalledTimes(1)
  })
})

describe('dev server request feed', () => {
  it('should keep its own loading and error responses out of the feed', async () => {
    const server = createServer({ captureUIEvents: true })
    await server.init()
    const seen: Array<{ url: string, status: number }> = []
    server.on('request', event => seen.push({ url: event.url, status: event.status }))

    await expect(get(server, '/app')).resolves.toMatchObject({ status: 200 })

    loadNuxt.mockImplementation(() => Promise.reject(new Error('config exploded')))
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })
    await expect(get(server, '/broken')).resolves.toMatchObject({ status: 500 })

    await vi.waitFor(() => expect(seen).toContainEqual({ url: '/app', status: 200 }))
    expect(seen).not.toContainEqual(expect.objectContaining({ url: '/broken' }))
  })
})

describe('dev server failures', () => {
  it('should surface a first-run failure to the caller', async () => {
    loadNuxt.mockImplementation(() => Promise.reject(new Error('config exploded')))
    const server = createServer()

    await expect(server.init()).rejects.toThrow('config exploded')
  })

  it('should emit the failure and serve the error page when a load fails', async () => {
    const server = createServer()
    await server.init()
    const failure = new Promise<Error>(resolve => server.once('loading:error', resolve))

    loadNuxt.mockImplementation(() => Promise.reject(new Error('config exploded')))
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })

    await expect(failure).resolves.toMatchObject({ message: 'config exploded' })
    await expect(get(server)).resolves.toMatchObject({ status: 500 })
  })

  it('should report a failed reload without taking the server down', async () => {
    const server = createServer()
    await server.init()

    loadNuxt.mockImplementation(() => Promise.reject(new Error('broken on reload')))
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })

    const { status, body } = await get(server)
    expect(status).toBe(500)
    expect(body).toContain('broken on reload')
  })

  it('should recover once the config loads again', async () => {
    const server = createServer()
    await server.init()

    loadNuxt.mockImplementationOnce(() => Promise.reject(new Error('broken on reload')))
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })

    await expect(get(server)).resolves.toMatchObject({ status: 200, body: 'app' })
  })
})

describe('dev server reload', () => {
  it('should keep serving on the same port across a reload', async () => {
    const server = createServer()
    await server.init()
    const { port } = server.listener.address as AddressInfo

    await server.load(true, { type: 'shortcut' })

    expect((server.listener.address as AddressInfo).port).toBe(port)
    await expect(get(server)).resolves.toMatchObject({ status: 200 })
  })

  it('should load a fresh nuxt instance on reload', async () => {
    const server = createServer()
    await server.init()

    await server.load(true, { type: 'shortcut' })

    expect(loadNuxt).toHaveBeenCalledTimes(2)
  })

  it('should update the lock file when the build directory moves', async () => {
    const server = createServer()
    await server.init()

    loadNuxt.mockImplementation(() => Promise.resolve(createNuxt({ buildDir: join(cwd, '.other') })))
    await server.load(true, { type: 'config', files: [join(cwd, 'nuxt.config.ts')] })

    expect(existsSync(join(cwd, '.other', 'nuxt.lock'))).toBe(true)
    expect(existsSync(join(cwd, '.nuxt', 'nuxt.lock'))).toBe(false)
  })
})

describe('dev server listen options', () => {
  it('should bind the loopback address it was given', async () => {
    const server = createServer()

    await server.init()

    expect((server.listener.address as AddressInfo).address).toBe('127.0.0.1')
    expect(server.listener.url).toMatch('http://127.0.0.1:')
  })

  it('should fail with actionable advice when the port is taken and strict', async () => {
    const first = createServer()
    await first.init()
    const { port } = first.listener.address as AddressInfo

    const second = createServer({
      cwd,
      listenOverrides: { hostname: '127.0.0.1', port, strictPort: true, showURL: false, qr: false },
    })

    await expect(second.init()).rejects.toThrow(/already in use/)
  })

  it('should fall back to another port when one is taken', async () => {
    const first = createServer()
    await first.init()
    const { port } = first.listener.address as AddressInfo

    const second = createServer({
      cwd: await makeTempDir(),
      listenOverrides: { hostname: '127.0.0.1', port, showURL: false, qr: false },
    })
    await second.init()

    expect((second.listener.address as AddressInfo).port).not.toBe(port)
  })
})

describe('dev server restart', () => {
  it('should reload in place for a soft restart hook', async () => {
    const nuxt = createNuxt()
    loadNuxt.mockImplementation(() => Promise.resolve(nuxt))
    const server = createServer()
    await server.init()

    await nuxt.callHook('restart')

    expect(loadNuxt).toHaveBeenCalledTimes(2)
  })

  it('should ask for a new process on a hard restart hook', async () => {
    const nuxt = createNuxt()
    loadNuxt.mockImplementation(() => Promise.resolve(nuxt))
    const server = createServer()
    await server.init()
    const restart = new Promise<unknown>(resolve => server.once('restart', resolve))

    await nuxt.callHook('restart', { hard: true })

    await expect(restart).resolves.toMatchObject({ type: 'hook' })
    expect(loadNuxt).toHaveBeenCalledTimes(1)
  })

  it('should emit a change when the builder reports one', async () => {
    const nuxt = createNuxt()
    loadNuxt.mockImplementation(() => Promise.resolve(nuxt))
    const server = createServer()
    await server.init()
    const change = new Promise<void>(resolve => server.once('change', () => resolve()))

    await nuxt.callHook('builder:watch')

    await expect(change).resolves.toBeUndefined()
  })
})

describe('dev server config reload', () => {
  function stubConfigDiff(changedKeys: string[]) {
    diffNuxtConfig.mockImplementation(() => changedKeys.map(key => ({ key })))
    loadNuxtConfig.mockImplementation(async (options: { onConfigResolved?: (ctx: { rawConfig: Record<string, unknown> }) => void }) => {
      await options.onConfigResolved?.({ rawConfig: { revision: changedKeys.length } })
      return {}
    })
    loadNuxt.mockImplementation(async (options: { onConfigResolved?: (ctx: { rawConfig: Record<string, unknown> }) => void }) => {
      await options.onConfigResolved?.({ rawConfig: { revision: 0 } })
      return createNuxt()
    })
  }

  it('should skip a reload when the saved config resolves to the same values', async () => {
    stubConfigDiff([])
    const server = createServer()
    await server.init()
    loadNuxt.mockClear()

    server.scheduleReload({ type: 'config', files: [join(cwd, 'nuxt.config.ts')] })
    await vi.waitFor(() => expect(loadNuxtConfig).toHaveBeenCalled())

    expect(loadNuxt).not.toHaveBeenCalled()
  })

  it('should reload when the saved config changes a key', async () => {
    stubConfigDiff(['ssr'])
    const server = createServer()
    await server.init()
    loadNuxt.mockClear()

    server.scheduleReload({ type: 'config', files: [join(cwd, 'nuxt.config.ts')] })

    await vi.waitFor(() => expect(loadNuxt).toHaveBeenCalledTimes(1))
  })

  it('should collapse several changes in one debounce window into a single reload', async () => {
    stubConfigDiff(['ssr'])
    const server = createServer()
    await server.init()
    loadNuxt.mockClear()

    server.scheduleReload({ type: 'shortcut' })
    server.scheduleReload({ type: 'shortcut' })

    await vi.waitFor(() => expect(loadNuxt).toHaveBeenCalledTimes(1), { timeout: 10_000 })
    expect(loadNuxt).toHaveBeenCalledTimes(1)
  })
})

describe('dev server shutdown', () => {
  it('should close the nuxt instance and drop the lock', async () => {
    const nuxt = createNuxt()
    const close = vi.fn(() => Promise.resolve())
    nuxt.close = close
    loadNuxt.mockImplementation(() => Promise.resolve(nuxt))
    const server = createServer()
    await server.init()

    server.closeWatchers()
    await server.listener.close()
    await server.close()
    server.releaseLock()

    expect(close).toHaveBeenCalledTimes(1)
    expect(existsSync(join(cwd, '.nuxt', 'nuxt.lock'))).toBe(false)
  })

  it('should stop answering once the listener is closed', async () => {
    const server = createServer()
    await server.init()
    const { port } = server.listener.address as AddressInfo

    await server.listener.close()

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
  })

  it('should answer a request that was in flight when a reload starts', async () => {
    let release: (() => void) | undefined
    const nuxt = createNuxt()
    nuxt.server.handler = (_req, res) => {
      release = () => res.end('late')
    }
    loadNuxt.mockImplementation(() => Promise.resolve(nuxt))
    const server = createServer()
    await server.init()

    const pending = get(server)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))

    loadNuxt.mockImplementation(() => Promise.resolve(createNuxt()))
    await server.load(true, { type: 'shortcut' })

    await expect(pending).resolves.toMatchObject({ status: 503 })
  })
})

describe('dev server handover', () => {
  it('should take the lock from the process it is replacing', async () => {
    const { acquireLock } = await import('../../../src/utils/lockfile')
    const outgoing = acquireLock(join(cwd, '.nuxt'), { command: 'dev', cwd })
    expect(outgoing.release).toBeTypeOf('function')

    const server = createServer({ handoverFrom: process.pid })
    await server.init()

    const lock = JSON.parse(readFileSync(join(cwd, '.nuxt', 'nuxt.lock'), 'utf8'))
    expect(lock).toMatchObject({ pid: process.pid, port: (server.listener.address as AddressInfo).port })
  })

  it('should say who it handed over to when its own lock was claimed', async () => {
    const server = createServer()
    await server.init()
    const { getTakeoverPid, markTakenOver } = await import('../../../src/utils/lockfile')
    markTakenOver(join(cwd, '.nuxt'), process.ppid)
    expect(getTakeoverPid(join(cwd, '.nuxt'))).toBe(process.ppid)

    const notices: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      notices.push(String(chunk))
      return true
    })

    server.releaseLock()
    write.mockRestore()

    expect(notices.join('')).toContain(`Handed over to another \`nuxt dev\` (PID ${process.ppid})`)
  })
})
