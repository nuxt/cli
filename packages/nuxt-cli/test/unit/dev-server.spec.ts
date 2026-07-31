import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findDevServer, resolveLockDir, toLoopback } from '../../src/utils/dev-server'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-dev-server-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

async function writeLock(dir: string, info: Record<string, unknown> = {}) {
  await mkdir(join(cwd, dir), { recursive: true })
  await writeFile(join(cwd, dir, 'nuxt.lock'), JSON.stringify({
    pid: 424242,
    command: 'dev',
    cwd,
    interactive: false,
    url: 'http://localhost:3000',
    startedAt: Date.now(),
    ...info,
  }))
  vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
}

describe('resolveLockDir', () => {
  it('defaults to `.nuxt`', async () => {
    expect(await resolveLockDir(cwd)).toBe(join(cwd, '.nuxt'))
  })

  it('reads `buildDir` from `nuxt.config` when there is no `.nuxt`', async () => {
    await writeFile(join(cwd, 'nuxt.config.mjs'), 'export default { buildDir: ".build" }')

    expect(await resolveLockDir(cwd)).toBe(join(cwd, '.build'))
  })

  it('keeps the default when `.nuxt` exists, without reading the config', async () => {
    await mkdir(join(cwd, '.nuxt'), { recursive: true })
    await writeFile(join(cwd, 'nuxt.config.mjs'), 'throw new Error("config should not be evaluated")')

    expect(await resolveLockDir(cwd)).toBe(join(cwd, '.nuxt'))
  })
})

describe('findDevServer', () => {
  it('finds a server recorded in a custom build directory', async () => {
    await writeFile(join(cwd, 'nuxt.config.mjs'), 'export default { buildDir: ".build" }')
    await writeLock('.build')

    await expect(findDevServer(cwd)).resolves.toMatchObject({
      url: 'http://localhost:3000',
      pid: 424242,
    })
  })

  it('dials loopback for a server bound to every interface', async () => {
    await writeLock('.nuxt', { hostname: '0.0.0.0', url: 'http://0.0.0.0:3597' })

    await expect(findDevServer(cwd)).resolves.toMatchObject({ url: 'http://127.0.0.1:3597' })
  })

  it('strips a trailing slash from the recorded URL', async () => {
    await writeLock('.nuxt', { url: 'http://localhost:3000/' })

    await expect(findDevServer(cwd)).resolves.toMatchObject({ url: 'http://localhost:3000' })
  })

  it('ignores a build lock', async () => {
    await writeLock('.nuxt', { command: 'build', url: undefined })

    await expect(findDevServer(cwd)).resolves.toBeUndefined()
  })

  it('ignores a lock whose process is gone', async () => {
    await mkdir(join(cwd, '.nuxt'), { recursive: true })
    await writeFile(join(cwd, '.nuxt', 'nuxt.lock'), JSON.stringify({
      pid: 999999999,
      command: 'dev',
      cwd,
      interactive: false,
      url: 'http://localhost:3000',
      startedAt: Date.now(),
    }))

    await expect(findDevServer(cwd)).resolves.toBeUndefined()
  })

  it('uses an explicit build directory when given one', async () => {
    await writeLock('custom')

    await expect(findDevServer(cwd, 'custom')).resolves.toMatchObject({ pid: 424242 })
  })
})

describe('toLoopback', () => {
  it.each([
    ['http://0.0.0.0:3000', 'http://127.0.0.1:3000'],
    ['http://[::]:3000', 'http://[::1]:3000'],
    ['https://0.0.0.0:3000/', 'https://127.0.0.1:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://192.168.1.5:3000', 'http://192.168.1.5:3000'],
    ['not a url/', 'not a url'],
  ])('%s -> %s', (input, expected) => {
    expect(toLoopback(input)).toBe(expected)
  })
})
