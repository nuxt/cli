import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Force the "human" path: enforcement is off, but the presence marker should
// still be written so tooling can detect a running dev server.
vi.mock('std-env', async (importOriginal) => {
  const original = await importOriginal<typeof import('std-env')>()
  return { ...original, isAgent: false }
})

const { acquireLock, readActiveLock } = await import('../../src/utils/lockfile')

const LOCK = 'nuxt.lock'

describe('lockfile presence (enforcement off)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-lock-presence-'))
    delete process.env.NUXT_IGNORE_LOCK
    delete process.env.NUXT_LOCK
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes the presence marker on a clean dir even without enforcement', () => {
    const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
    expect(lock.existing).toBeUndefined()
    expect(lock.release).toBeDefined()
    expect(existsSync(join(tempDir, LOCK))).toBe(true)
    lock.release!()
    expect(existsSync(join(tempDir, LOCK))).toBe(false)
  })

  it('takes over a live foreign lock instead of refusing (detection-only)', () => {
    const foreignPid = 424242
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === foreignPid) {
        return true as unknown as true
      }
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    try {
      writeFileSync(join(tempDir, LOCK), JSON.stringify({
        pid: foreignPid,
        command: 'dev',
        cwd: '/other',
        startedAt: Date.now(),
      }))

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      // No enforcement → never refuses; we advertise ourselves as the marker.
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(JSON.parse(readFileSync(join(tempDir, LOCK), 'utf-8')).pid).toBe(process.pid)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('refuses to clobber a live build lock even in detection-only mode', () => {
    const buildPid = 424242
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === buildPid) {
        return true as unknown as true
      }
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    try {
      writeFileSync(join(tempDir, LOCK), JSON.stringify({
        pid: buildPid,
        command: 'build',
        cwd: '/other',
        startedAt: Date.now(),
      }))

      // dev acquires with enforce:false, but an active build must not be clobbered.
      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeDefined()
      expect(lock.existing!.command).toBe('build')
      expect(lock.release).toBeUndefined()
      // The build marker is left intact.
      expect(JSON.parse(readFileSync(join(tempDir, LOCK), 'utf-8')).pid).toBe(buildPid)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('explicit enforce:false never refuses even when enforcement would be on', () => {
    process.env.NUXT_LOCK = '1' // would enable enforcement by default
    const foreignPid = 424242
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === foreignPid) {
        return true as unknown as true
      }
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    try {
      writeFileSync(join(tempDir, LOCK), JSON.stringify({
        pid: foreignPid,
        command: 'dev',
        cwd: '/other',
        startedAt: Date.now(),
      }))

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' }, { enforce: false })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(JSON.parse(readFileSync(join(tempDir, LOCK), 'utf-8')).pid).toBe(process.pid)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('writes nothing when NUXT_IGNORE_LOCK is set', () => {
    process.env.NUXT_IGNORE_LOCK = '1'
    const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
    expect(lock.release).toBeDefined()
    expect(existsSync(join(tempDir, LOCK))).toBe(false)
  })

  describe('readActiveLock', () => {
    it('returns the lock for a live process', () => {
      const foreignPid = 525252
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === foreignPid) {
          return true as unknown as true
        }
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      })
      try {
        writeFileSync(join(tempDir, LOCK), JSON.stringify({
          pid: foreignPid,
          command: 'dev',
          cwd: '/project',
          startedAt: Date.now(),
        }))
        expect(readActiveLock(tempDir)?.pid).toBe(foreignPid)
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('returns undefined for a dead process', () => {
      writeFileSync(join(tempDir, LOCK), JSON.stringify({
        pid: 999999999,
        command: 'dev',
        cwd: '/project',
        startedAt: Date.now(),
      }))
      expect(readActiveLock(tempDir)).toBeUndefined()
    })

    it('returns undefined when no lock file exists', () => {
      expect(readActiveLock(tempDir)).toBeUndefined()
    })
  })
})
