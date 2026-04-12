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

const { acquireLock, formatLockError, isLockEnabled, updateLock } = await import('../../src/utils/lockfile')

describe('lockfile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-lockfile-test-'))
    delete process.env.NUXT_IGNORE_LOCK
    delete process.env.NUXT_LOCK
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('isLockEnabled', () => {
    it('is enabled when isAgent is true (mocked)', () => {
      expect(isLockEnabled()).toBe(true)
    })

    it('nUXT_IGNORE_LOCK=1 disables locking', () => {
      process.env.NUXT_IGNORE_LOCK = '1'
      expect(isLockEnabled()).toBe(false)
    })

    it('nUXT_LOCK=1 forces locking on', () => {
      process.env.NUXT_LOCK = '1'
      expect(isLockEnabled()).toBe(true)
    })

    it('nUXT_IGNORE_LOCK takes precedence over NUXT_LOCK', () => {
      process.env.NUXT_LOCK = '1'
      process.env.NUXT_IGNORE_LOCK = '1'
      expect(isLockEnabled()).toBe(false)
    })
  })

  describe('acquireLock', () => {
    it('writes lock file and returns release function', () => {
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      const lockPath = join(tempDir, 'nuxt.lock')

      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(existsSync(lockPath)).toBe(true)
      const written = JSON.parse(readFileSync(lockPath, 'utf-8'))
      expect(written.pid).toBe(process.pid)
      expect(written.command).toBe('dev')
      expect(written.cwd).toBe('/project')
      expect(typeof written.startedAt).toBe('number')

      lock.release!()
      expect(existsSync(lockPath)).toBe(false)
    })

    it('returns existing lock when another live process holds it', async () => {
      // Stub process.kill so liveness is deterministic across OSes (Windows
      // PID 1 semantics differ).
      const foreignPid = 424242
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === foreignPid) {
          return true as unknown as true
        }
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      })
      try {
        await mkdir(tempDir, { recursive: true })
        writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
          pid: foreignPid,
          command: 'dev',
          cwd: '/other',
          startedAt: Date.now(),
        }))

        const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
        expect(lock.existing).toBeDefined()
        expect(lock.existing!.pid).toBe(foreignPid)
        expect(lock.existing!.cwd).toBe('/other')
        expect(lock.release).toBeUndefined()
        // File untouched.
        expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(true)
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('takes over a lock whose PID is dead', async () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: 999999999,
        command: 'dev',
        cwd: '/other',
        startedAt: Date.now(),
      }))

      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      const written = JSON.parse(readFileSync(join(tempDir, 'nuxt.lock'), 'utf-8'))
      expect(written.pid).toBe(process.pid)
      lock.release!()
    })

    it('takes over a lock older than the PID-recycling safety window', () => {
      // Mock the PID as alive; age-based override should still kick in.
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
      try {
        writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
          pid: 424242,
          command: 'dev',
          cwd: '/other',
          startedAt: Date.now() - 25 * 60 * 60 * 1000,
        }))

        const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
        expect(lock.existing).toBeUndefined()
        expect(lock.release).toBeDefined()
        lock.release!()
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('takes over a lock owned by this process (re-entrancy)', () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: process.pid,
        command: 'dev',
        cwd: '/project',
        startedAt: Date.now(),
      }))

      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      lock.release!()
    })

    it('cleans up corrupted lock files', () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), 'not valid json')

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      const written = JSON.parse(readFileSync(join(tempDir, 'nuxt.lock'), 'utf-8'))
      expect(written.pid).toBe(process.pid)
      lock.release!()
    })

    it('release is idempotent', () => {
      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      lock.release!()
      lock.release!() // should not throw
    })

    it('release does not remove another process\'s lock', () => {
      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      // Simulate another process replacing the file.
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: 1,
        command: 'dev',
        cwd: '/other',
        startedAt: Date.now(),
      }))
      lock.release!()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(true)
    })

    it('is a no-op when locking is disabled', () => {
      process.env.NUXT_IGNORE_LOCK = '1'
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(false)
      lock.release!()
    })

    it('does not register a duplicate exit listener on release', () => {
      const before = process.listenerCount('exit')
      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      expect(process.listenerCount('exit')).toBe(before + 1)
      lock.release!()
      expect(process.listenerCount('exit')).toBe(before)
    })
  })

  describe('updateLock', () => {
    it('overwrites our own lock with new metadata', () => {
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      const originalStart = JSON.parse(readFileSync(join(tempDir, 'nuxt.lock'), 'utf-8')).startedAt

      updateLock(tempDir, {
        command: 'dev',
        cwd: '/project',
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
      })

      const written = JSON.parse(readFileSync(join(tempDir, 'nuxt.lock'), 'utf-8'))
      expect(written.port).toBe(3000)
      expect(written.url).toBe('http://127.0.0.1:3000')
      // Preserves startedAt from original acquisition.
      expect(written.startedAt).toBe(originalStart)
      lock.release!()
    })

    it('does not overwrite another process\'s lock', () => {
      writeFileSync(join(tempDir, 'nuxt.lock'), JSON.stringify({
        pid: 1,
        command: 'dev',
        cwd: '/other',
        startedAt: Date.now(),
      }))

      updateLock(tempDir, {
        command: 'dev',
        cwd: '/project',
        port: 3000,
      })

      const written = JSON.parse(readFileSync(join(tempDir, 'nuxt.lock'), 'utf-8'))
      expect(written.pid).toBe(1)
      expect(written.port).toBeUndefined()
    })

    it('is a no-op when locking is disabled', () => {
      process.env.NUXT_IGNORE_LOCK = '1'
      updateLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(existsSync(join(tempDir, 'nuxt.lock'))).toBe(false)
    })
  })

  describe('formatLockError', () => {
    it('includes actionable dev server info', () => {
      const message = formatLockError({
        pid: 12345,
        command: 'dev',
        cwd: '/my/project',
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
        startedAt: Date.now(),
      })

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
        cwd: '/my/project',
        startedAt: Date.now(),
      })

      expect(message).toContain('build')
      expect(message).toContain('12345')
      expect(message).not.toContain('connect to')
    })
  })
})
