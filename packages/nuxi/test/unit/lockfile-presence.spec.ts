import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const { acquireLock, lockPathFor, locksDir, readActiveLock, readActiveLocks } = await import('../../src/utils/lockfile')

function writeMarker(buildDir: string, info: Record<string, unknown>) {
  mkdirSync(locksDir(buildDir), { recursive: true })
  writeFileSync(lockPathFor(buildDir, info.pid as number), JSON.stringify({ command: 'dev', cwd: '/other', startedAt: Date.now(), ...info }))
}

function mockAlive(...pids: number[]) {
  return vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pids.includes(pid as number)) {
      return true as unknown as true
    }
    throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
  })
}

describe('lockfile presence (enforcement off)', () => {
  let tempDir: string
  const ownPath = (dir: string) => lockPathFor(dir, process.pid)

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
    expect(existsSync(ownPath(tempDir))).toBe(true)
    lock.release!()
    expect(existsSync(ownPath(tempDir))).toBe(false)
  })

  it('coexists with a live foreign dev marker instead of refusing (detection-only)', () => {
    const foreignPid = 424242
    const killSpy = mockAlive(foreignPid)
    try {
      writeMarker(tempDir, { pid: foreignPid, command: 'dev' })

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      // No enforcement → never refuses; we advertise ourselves alongside the peer.
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(JSON.parse(readFileSync(ownPath(tempDir), 'utf-8')).pid).toBe(process.pid)
      expect(existsSync(lockPathFor(tempDir, foreignPid))).toBe(true)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('refuses to start dev alongside a live build even in detection-only mode', () => {
    const buildPid = 424242
    const killSpy = mockAlive(buildPid)
    try {
      writeMarker(tempDir, { pid: buildPid, command: 'build' })

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
      expect(lock.existing).toBeDefined()
      expect(lock.existing!.command).toBe('build')
      expect(lock.release).toBeUndefined()
      // The build marker is left intact; we never wrote our own.
      expect(existsSync(lockPathFor(tempDir, buildPid))).toBe(true)
      expect(existsSync(ownPath(tempDir))).toBe(false)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('explicit enforce:false never refuses a peer dev even when enforcement would be on', () => {
    process.env.NUXT_LOCK = '1' // would enable enforcement by default
    const foreignPid = 424242
    const killSpy = mockAlive(foreignPid)
    try {
      writeMarker(tempDir, { pid: foreignPid, command: 'dev' })

      const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' }, { enforce: false })
      expect(lock.existing).toBeUndefined()
      expect(lock.release).toBeDefined()
      expect(JSON.parse(readFileSync(ownPath(tempDir), 'utf-8')).pid).toBe(process.pid)
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('writes nothing when NUXT_IGNORE_LOCK is set', () => {
    process.env.NUXT_IGNORE_LOCK = '1'
    const lock = acquireLock(tempDir, { command: 'dev', cwd: '/project' })
    expect(lock.release).toBeDefined()
    expect(existsSync(ownPath(tempDir))).toBe(false)
  })

  describe('readActiveLock', () => {
    it('returns the lock for a live process', () => {
      const foreignPid = 525252
      const killSpy = mockAlive(foreignPid)
      try {
        writeMarker(tempDir, { pid: foreignPid, command: 'dev', cwd: '/project' })
        expect(readActiveLock(tempDir)?.pid).toBe(foreignPid)
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('returns undefined for a dead process', () => {
      writeMarker(tempDir, { pid: 999999999, command: 'dev', cwd: '/project' })
      expect(readActiveLock(tempDir)).toBeUndefined()
    })

    it('returns undefined when no lock dir exists', () => {
      expect(readActiveLock(tempDir)).toBeUndefined()
    })

    it('prefers a build lock over a dev lock', () => {
      const devPid = 111111
      const buildPid = 222222
      const killSpy = mockAlive(devPid, buildPid)
      try {
        writeMarker(tempDir, { pid: devPid, command: 'dev' })
        writeMarker(tempDir, { pid: buildPid, command: 'build' })
        expect(readActiveLock(tempDir)?.command).toBe('build')
      }
      finally {
        killSpy.mockRestore()
      }
    })
  })

  describe('readActiveLocks', () => {
    it('returns every live peer, newest first', () => {
      const olderPid = 111111
      const newerPid = 222222
      const killSpy = mockAlive(olderPid, newerPid)
      try {
        writeMarker(tempDir, { pid: olderPid, command: 'dev', startedAt: Date.now() - 2000 })
        writeMarker(tempDir, { pid: newerPid, command: 'dev', startedAt: Date.now() - 1000 })
        const locks = readActiveLocks(tempDir)
        expect(locks.map(l => l.pid)).toEqual([newerPid, olderPid])
      }
      finally {
        killSpy.mockRestore()
      }
    })

    it('a dead peer never hides a live one (and is pruned)', () => {
      const livePid = 333333
      const deadPid = 999999999
      const killSpy = mockAlive(livePid)
      try {
        writeMarker(tempDir, { pid: livePid, command: 'dev' })
        writeMarker(tempDir, { pid: deadPid, command: 'dev' })
        const locks = readActiveLocks(tempDir)
        expect(locks.map(l => l.pid)).toEqual([livePid])
        // Dead marker pruned on read.
        expect(existsSync(lockPathFor(tempDir, deadPid))).toBe(false)
      }
      finally {
        killSpy.mockRestore()
      }
    })
  })
})
