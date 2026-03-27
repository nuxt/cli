import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isWindows = process.platform === 'win32'

vi.mock('std-env', async (importOriginal) => {
  const original = await importOriginal<typeof import('std-env')>()
  return { ...original, isAgent: true }
})

const { checkLock, formatLockError, writeLock } = await import('../../src/utils/lockfile')

describe('lockfile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-lockfile-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('checkLock', () => {
    it('returns undefined when no lock file exists', () => {
      expect(checkLock(tempDir)).toBeUndefined()
    })

    it('returns undefined for own PID (self-check)', async () => {
      await mkdir(tempDir, { recursive: true })
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: process.pid,
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
        command: 'dev',
        startedAt: Date.now(),
      }))

      expect(checkLock(tempDir)).toBeUndefined()
    })

    it('cleans up stale lock files from dead processes', async () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: 999999999,
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
        command: 'dev',
        startedAt: Date.now(),
      }))

      expect(checkLock(tempDir)).toBeUndefined()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(false)
    })

    it('cleans up corrupted lock files', async () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), 'not valid json')

      expect(checkLock(tempDir)).toBeUndefined()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(false)
    })
  })

  describe('writeLock', () => {
    it('writes lock file and returns cleanup function', async () => {
      const cleanup = await writeLock(tempDir, {
        pid: process.pid,
        command: 'dev',
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
        startedAt: Date.now(),
      })
      const lockPath = join(tempDir, 'nuxt.lock')

      expect(existsSync(lockPath)).toBe(true)
      const written = JSON.parse(readFileSync(lockPath, 'utf-8'))
      expect(written.pid).toBe(process.pid)
      expect(written.port).toBe(3000)
      expect(written.command).toBe('dev')

      cleanup()
      expect(existsSync(lockPath)).toBe(false)
    })

    it('returns noop when lock already exists (atomic write)', async () => {
      // First lock succeeds
      const cleanup1 = await writeLock(tempDir, {
        pid: process.pid,
        command: 'dev',
        startedAt: Date.now(),
      })
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(true)

      // Second lock returns noop (file exists)
      const cleanup2 = await writeLock(tempDir, {
        pid: process.pid,
        command: 'dev',
        startedAt: Date.now(),
      })

      // cleanup2 is noop, should not remove the file
      cleanup2()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(true)

      // cleanup1 still works
      cleanup1()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(false)
    })

    it('cleanup is idempotent', async () => {
      const cleanup = await writeLock(tempDir, {
        pid: process.pid,
        command: 'build',
        startedAt: Date.now(),
      })
      cleanup()
      cleanup() // should not throw
    })
  })

  describe('formatLockError', () => {
    it('includes actionable dev server info', () => {
      const message = formatLockError({
        pid: 12345,
        command: 'dev',
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
        startedAt: Date.now(),
      }, '/my/project')

      expect(message).toContain('dev server')
      expect(message).toContain('http://127.0.0.1:3000')
      expect(message).toContain('12345')
      expect(message).toContain('/my/project')
      expect(message).toContain(isWindows ? 'taskkill /PID 12345 /F' : 'kill 12345')
      expect(message).toContain('connect to')
    })

    it('formats build lock without URL', () => {
      const message = formatLockError({
        pid: 12345,
        command: 'build',
        startedAt: Date.now(),
      }, '/my/project')

      expect(message).toContain('build')
      expect(message).toContain('12345')
      expect(message).not.toContain('connect to')
    })
  })
})
