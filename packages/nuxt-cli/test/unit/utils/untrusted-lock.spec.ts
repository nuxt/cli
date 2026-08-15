import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { takeOverDevServer } from '../../../src/dev/takeover'
import { findDevServer, findNitroDevWorker } from '../../../src/utils/dev-server'
import { parseLockInfo, readLock } from '../../../src/utils/lockfile'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'nuxt-untrusted-lock-'))
  delete process.env.NUXT_IGNORE_LOCK
  delete process.env.NUXT_LOCK
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(tempDir, { recursive: true, force: true })
})

function baseLock(overrides: Record<string, unknown> = {}) {
  return {
    pid: process.pid,
    startedAt: Date.now(),
    command: 'dev',
    cwd: '/tmp/project',
    interactive: false,
    ...overrides,
  }
}

async function writeLock(contents: unknown): Promise<string> {
  await writeFile(join(tempDir, 'nuxt.lock'), typeof contents === 'string' ? contents : JSON.stringify(contents))
  return tempDir
}

describe('parseLockInfo', () => {
  it('should reject a lock with a non-positive pid', () => {
    expect(parseLockInfo(baseLock({ pid: -1 }))).toBeUndefined()
    expect(parseLockInfo(baseLock({ pid: 0 }))).toBeUndefined()
    expect(parseLockInfo(baseLock({ pid: 1.5 }))).toBeUndefined()
    expect(parseLockInfo(baseLock({ pid: '123' }))).toBeUndefined()
  })

  it('should reject a lock with an unknown command', () => {
    expect(parseLockInfo(baseLock({ command: 'rm -rf /' }))).toBeUndefined()
  })

  it('should reject anything that is not an object', () => {
    expect(parseLockInfo(null)).toBeUndefined()
    expect(parseLockInfo([baseLock()])).toBeUndefined()
    expect(parseLockInfo('dev')).toBeUndefined()
  })

  it('should drop a negative parent pid rather than the whole lock', () => {
    expect(parseLockInfo(baseLock({ parentPid: -1 }))?.parentPid).toBeUndefined()
    expect(parseLockInfo(baseLock({ takenOverBy: -1 }))?.takenOverBy).toBeUndefined()
  })

  it('should drop an out-of-range port', () => {
    expect(parseLockInfo(baseLock({ port: 0 }))?.port).toBeUndefined()
    expect(parseLockInfo(baseLock({ port: 70_000 }))?.port).toBeUndefined()
    expect(parseLockInfo(baseLock({ port: 3000 }))?.port).toBe(3000)
  })

  it('should drop a url that is not http or https', () => {
    expect(parseLockInfo(baseLock({ url: 'file:///etc/passwd' }))?.url).toBeUndefined()
    expect(parseLockInfo(baseLock({ url: 'not a url' }))?.url).toBeUndefined()
    expect(parseLockInfo(baseLock({ url: 'http://localhost:3000' }))?.url).toBe('http://localhost:3000')
  })

  it('should strip control characters from displayed strings', () => {
    const info = parseLockInfo(baseLock({ cwd: '/tmp/\u001B[2Jproject\u0007' }))
    expect(info?.cwd).toBe('/tmp/[2Jproject')
  })

  it('should reject a lock timestamped far into the future', () => {
    expect(parseLockInfo(baseLock({ startedAt: Number.MAX_VALUE }))).toBeUndefined()
    expect(parseLockInfo(baseLock({ startedAt: Date.now() + 60 * 60 * 1000 }))).toBeUndefined()
    expect(parseLockInfo(baseLock({ startedAt: Date.now() + 1000 }))).toBeDefined()
  })

  it('should cap the length of strings it keeps', () => {
    expect(parseLockInfo(baseLock({ cwd: 'a'.repeat(5000) }))?.cwd).toHaveLength(1024)
  })
})

describe('reading an untrusted lock', () => {
  it('should ignore a lock file that is not valid json', async () => {
    expect(readLock(await writeLock('}{'))).toBeUndefined()
  })

  it('should ignore a lock claiming a negative pid', async () => {
    expect(readLock(await writeLock(baseLock({ pid: -1, port: 3000 })))).toBeUndefined()
  })

  it('should never signal a process group during takeover', async () => {
    const kill = vi.spyOn(process, 'kill')
    const result = await takeOverDevServer(
      await writeLock(baseLock({ pid: -1, port: 3000, url: 'http://localhost:3000' })),
      { takeover: true },
    )

    expect(result.action).toBe('none')
    for (const call of kill.mock.calls) {
      expect(call[0]).toBeGreaterThan(0)
    }
  })

  it('should not resolve a dev server url pointing at another scheme', async () => {
    const dir = await writeLock(baseLock({ pid: process.ppid, url: 'file:///etc/passwd' }))
    await expect(findDevServer(dir, dir)).resolves.toBeUndefined()
  })

  it('should resolve a dev server recorded with an http url', async () => {
    const dir = await writeLock(baseLock({ pid: process.ppid, url: 'http://localhost:3000' }))
    await expect(findDevServer(dir, dir)).resolves.toMatchObject({ url: 'http://localhost:3000' })
  })
})

describe('findNitroDevWorker', () => {
  it('should ignore a worker address on a remote host', async () => {
    await writeFile(join(tempDir, 'nitro.json'), JSON.stringify({
      dev: { pid: process.pid, workerAddress: { host: 'evil.example.com', port: 80 } },
    }))

    await expect(findNitroDevWorker(tempDir, tempDir)).resolves.toBeUndefined()
  })

  it('should accept a loopback worker address', async () => {
    await writeFile(join(tempDir, 'nitro.json'), JSON.stringify({
      dev: { pid: process.pid, workerAddress: { host: '127.0.0.1', port: 3000 } },
    }))

    await expect(findNitroDevWorker(tempDir, tempDir)).resolves.toMatchObject({ url: 'http://127.0.0.1:3000' })
  })
})
