import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isWindows = process.platform === 'win32'

vi.mock('std-env', async (importOriginal) => {
  const original = await importOriginal<typeof import('std-env')>()
  return { ...original, isAgent: true }
})

const { acquireLock, formatLockError, isLockEnabled, lockPathFor, locksDir, updateLock } = await import('../../src/utils/lockfile')

/** Write a foreign presence marker the way another process would. */
function writeMarker(buildDir: string, info: Record<string, unknown>) {
  mkdirSync(locksDir(buildDir), { recursive: true })
  writeFileSync(lockPathFor(buildDir, info.pid as number), JSON.stringify({ command: 'dev', cwd: '/other', startedAt: Date.now(), ...info }))
}

describe('lockfile', () => {
  let tempDir: string
  const ownPath = (dir: string) => lockPathFor(dir, process.pid)

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
    it('writes a per-process marker and returns release function', () => {
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })

      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(existsSync(ownPath(tempDir))).toBe(true)
      const written = JSON.parse(readFileSync(ownPath(tempDir), 'utf-8'))
      expect(written.pid).toBe(process.pid)
      expect(written.command).toBe('dev')
      expect(written.cwd).toBe('/project')
      expect(typeof written.startedAt).toBe('number')
      expect(typeof written.token).toBe('string')
      expect(lock.peers).toEqual([])

      lock.release!()
      expect(existsSync(ownPath(tempDir))).toBe(false)
    })

    it('creates the locks dir if it does not exist yet', async () => {
      const buildDir = join(tempDir, 'missing', '.nuxt')
      expect(existsSync(buildDir)).toBe(false)

      const lock = acquireLock(buildDir, { command: 'dev', cwd: '/project' })

      expect(lock.existing).toBeUndefined()
      expect(existsSync(ownPath(buildDir))).toBe(true)

      lock.release!()
    })

    it('peer dev servers coexist (no clobber)', () => {
      const peerPid = 424242
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === peerPid) {
          return true as unknown as true
        }
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      })
      try {
        writeMarker(tempDir, { pid: peerPid, command: 'dev' })

        const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' }, { enforce: false })
        expect(lock.existing).toBeUndefined()
        expect(lock.release).toBeDefined()
        // Both markers live side by side, and the peer is reported back.
        expect(existsSync(lockPathFor(tempDir, peerPid))).toBe(true)
        expect(existsSync(ownPath(tempDir))).toBe(true)
        expect(lock.peers?.map(p => p.pid)).toContain(peerPid)
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('returns existing lock when another live process holds it (enforced)', () => {
      const foreignPid = 424242
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === foreignPid) {
          return true as unknown as true
        }
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      })
      try {
        writeMarker(tempDir, { pid: foreignPid, command: 'dev', cwd: '/other' })

        const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
        expect(lock.existing).toBeDefined()
        expect(lock.existing!.pid).toBe(foreignPid)
        expect(lock.existing!.cwd).toBe('/other')
        expect(lock.release).toBeUndefined()
        // Foreign marker untouched; we never wrote our own.
        expect(existsSync(lockPathFor(tempDir, foreignPid))).toBe(true)
        expect(existsSync(ownPath(tempDir))).toBe(false)
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('prunes and takes over a marker whose PID is dead', () => {
      const deadPid = 999999999
      writeMarker(tempDir, { pid: deadPid, command: 'dev' })

      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      // Dead marker pruned, ours written.
      expect(existsSync(lockPathFor(tempDir, deadPid))).toBe(false)
      expect(JSON.parse(readFileSync(ownPath(tempDir), 'utf-8')).pid).toBe(process.pid)
      lock.release!()
    })

    it('takes over a marker older than the PID-recycling safety window', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
      try {
        writeMarker(tempDir, { pid: 424242, command: 'dev', startedAt: Date.now() - 25 * 60 * 60 * 1000 })

        const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
        expect(lock.existing).toBeUndefined()
        expect(lock.release).toBeDefined()
        lock.release!()
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('ignores a marker owned by this process when scanning (re-entrancy)', () => {
      writeMarker(tempDir, { pid: process.pid, command: 'dev', cwd: '/project' })

      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      lock.release!()
    })

    it('acquires despite a corrupted sibling marker', () => {
      mkdirSync(locksDir(tempDir), { recursive: true })
      writeFileSync(join(locksDir(tempDir), '12345.json'), 'not valid json')

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(JSON.parse(readFileSync(ownPath(tempDir), 'utf-8')).pid).toBe(process.pid)
      lock.release!()
    })

    it('release is idempotent', () => {
      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      lock.release!()
      lock.release!() // should not throw
    })

    it('release does not remove a marker no longer carrying our token', () => {
      const lock = acquireLock(tempDir, { command: 'build', cwd: '/project' })
      // Simulate the file being replaced (e.g. recycled PID) so our token no longer matches.
      writeFileSync(ownPath(tempDir), JSON.stringify({ pid: process.pid, command: 'dev', cwd: '/other', startedAt: Date.now(), token: 'someone-else' }))
      lock.release!()
      expect(existsSync(ownPath(tempDir))).toBe(true)
    })

    it('a stale release does not delete a newer same-process re-acquire (reload safety)', () => {
      const first = acquireLock(tempDir, { command: 'dev', cwd: '/project' }, { enforce: false })
      const second = acquireLock(tempDir, { command: 'dev', cwd: '/project' }, { enforce: false })
      first.release!()
      expect(existsSync(ownPath(tempDir))).toBe(true)
      second.release!()
      expect(existsSync(ownPath(tempDir))).toBe(false)
    })

    it('is a no-op when locking is disabled', () => {
      process.env.NUXT_IGNORE_LOCK = '1'
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(existsSync(ownPath(tempDir))).toBe(false)
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
    it('overwrites our own marker with new metadata', () => {
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      const originalStart = JSON.parse(readFileSync(ownPath(tempDir), 'utf-8')).startedAt

      updateLock(tempDir, {
        command: 'dev',
        cwd: '/project',
        port: 3000,
        hostname: '127.0.0.1',
        url: 'http://127.0.0.1:3000',
      })

      const written = JSON.parse(readFileSync(ownPath(tempDir), 'utf-8'))
      expect(written.port).toBe(3000)
      expect(written.url).toBe('http://127.0.0.1:3000')
      // Preserves startedAt from original acquisition.
      expect(written.startedAt).toBe(originalStart)
      lock.release!()
    })

    it('does not adopt a foreign marker left at our path by a recycled PID', () => {
      // A previous process with our PID could leave a marker at our path.
      mkdirSync(locksDir(tempDir), { recursive: true })
      writeFileSync(ownPath(tempDir), JSON.stringify({ pid: 1, command: 'dev', cwd: '/other', startedAt: Date.now() }))

      updateLock(tempDir, { command: 'dev', cwd: '/project', port: 3000 })

      const written = JSON.parse(readFileSync(ownPath(tempDir), 'utf-8'))
      expect(written.pid).toBe(1)
      expect(written.port).toBeUndefined()
    })

    it('is a no-op when locking is disabled', () => {
      process.env.NUXT_IGNORE_LOCK = '1'
      updateLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(existsSync(ownPath(tempDir))).toBe(false)
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
