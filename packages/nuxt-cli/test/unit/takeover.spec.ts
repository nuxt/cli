import type { TakeoverChoice } from '../../src/dev/takeover'
import type { LockInfo } from '../../src/utils/lockfile'

import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkPort = vi.hoisted(() => vi.fn<(port: number, host?: string) => Promise<number | false>>())

vi.mock('get-port-please', () => ({ checkPort }))

const { formatTakeoverRefusal, takeOverDevServer } = await import('../../src/dev/takeover')
const { markTakenOver, readLock, updateLock } = await import('../../src/utils/lockfile')

const HOLDER_PID = 424242

function writeLock(buildDir: string, info: Partial<LockInfo> = {}): LockInfo {
  const lock: LockInfo = {
    pid: HOLDER_PID,
    startedAt: Date.now(),
    command: 'dev',
    cwd: '/other',
    interactive: false,
    port: 3000,
    hostname: '127.0.0.1',
    url: 'http://127.0.0.1:3000',
    ...info,
  }
  mkdirSync(buildDir, { recursive: true })
  writeFileSync(join(buildDir, 'nuxt.lock'), JSON.stringify(lock))
  return lock
}

/** Simulate a process that is alive until it is signalled. */
function mockProcess({ alive = true, diesOn }: { alive?: boolean, diesOn?: NodeJS.Signals | 'never' } = {}) {
  let isAlive = alive
  const signals: Array<[number, string | number]> = []
  const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 0 || signal === undefined) {
      if (pid === process.pid) {
        return true as never
      }
      if (!isAlive) {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      }
      return true as never
    }
    signals.push([pid as number, signal])
    if (diesOn !== 'never' && signal === (diesOn ?? 'SIGTERM')) {
      isAlive = false
      checkPort.mockResolvedValue(3000)
    }
    return true as never
  })
  return { signals, kill }
}

describe('takeOverDevServer', () => {
  let buildDir: string

  beforeEach(async () => {
    buildDir = await mkdtemp(join(tmpdir(), 'nuxt-takeover-test-'))
    delete process.env.NUXT_IGNORE_LOCK
    delete process.env.NUXT_LOCK
    // Port in use by default: an active dev server holds it.
    checkPort.mockResolvedValue(false)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(buildDir, { recursive: true, force: true })
  })

  it('does nothing when there is no lock', async () => {
    expect(await takeOverDevServer(buildDir)).toEqual({ action: 'none' })
  })

  it('does nothing when locking is disabled', async () => {
    process.env.NUXT_IGNORE_LOCK = '1'
    writeLock(buildDir)
    expect(await takeOverDevServer(buildDir)).toEqual({ action: 'none' })
  })

  it('never takes over a build lock', async () => {
    writeLock(buildDir, { command: 'build', port: undefined, url: undefined })
    mockProcess()
    expect(await takeOverDevServer(buildDir, { interactive: false })).toEqual({ action: 'none' })
  })

  it('never takes over when an explicit port differs from the holder\'s', async () => {
    writeLock(buildDir)
    const proc = mockProcess()
    expect(await takeOverDevServer(buildDir, { requestedPort: 4000, interactive: false })).toEqual({ action: 'none' })
    expect(proc.signals).toHaveLength(0)
  })

  it('takes over when the explicit port matches the holder\'s', async () => {
    writeLock(buildDir)
    mockProcess()
    expect(await takeOverDevServer(buildDir, { requestedPort: 3000, interactive: false }))
      .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
  })

  it('reports a stale lock when the holder is dead', async () => {
    writeLock(buildDir)
    const proc = mockProcess({ alive: false })
    expect(await takeOverDevServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(proc.signals).toHaveLength(0)
  })

  it('reports a stale lock when the port is free (recycled PID)', async () => {
    writeLock(buildDir)
    checkPort.mockResolvedValue(3000)
    const proc = mockProcess()
    expect(await takeOverDevServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(proc.signals).toHaveLength(0)
  })

  describe('decision matrix', () => {
    it('non-interactive holder, non-interactive caller: takes over', async () => {
      writeLock(buildDir, { interactive: false })
      const proc = mockProcess()
      expect(await takeOverDevServer(buildDir, { interactive: false }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM']])
    })

    it('non-interactive holder, interactive caller: prompts, defaulting to takeover', async () => {
      writeLock(buildDir, { interactive: false })
      mockProcess()
      const prompt = vi.fn(async (_lock: LockInfo, fallback: TakeoverChoice) => fallback)
      const result = await takeOverDevServer(buildDir, { interactive: true, prompt })
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ pid: HOLDER_PID }), 'takeover')
      expect(result).toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
    })

    it('interactive holder, non-interactive caller: refuses', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const result = await takeOverDevServer(buildDir, { interactive: false })
      expect(result).toMatchObject({ action: 'refused', reason: 'holder-interactive' })
      expect(proc.signals).toHaveLength(0)
    })

    it('interactive holder, interactive caller: prompts, defaulting to not starting', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const prompt = vi.fn(async (_lock: LockInfo, fallback: TakeoverChoice) => fallback)
      const result = await takeOverDevServer(buildDir, { interactive: true, prompt })
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ pid: HOLDER_PID }), 'abort')
      expect(result).toMatchObject({ action: 'refused', reason: 'declined' })
      expect(proc.signals).toHaveLength(0)
    })
  })

  describe('flags', () => {
    it('`--takeover` skips the prompt even for an interactive holder', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const prompt = vi.fn(async () => 'abort' as const)
      expect(await takeOverDevServer(buildDir, { takeover: true, interactive: true, prompt }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(prompt).not.toHaveBeenCalled()
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM']])
    })

    it('`--no-takeover` refuses without signalling anything', async () => {
      writeLock(buildDir, { interactive: false })
      const proc = mockProcess()
      const prompt = vi.fn(async () => 'takeover' as const)
      expect(await takeOverDevServer(buildDir, { takeover: false, interactive: true, prompt }))
        .toMatchObject({ action: 'refused', reason: 'disabled' })
      expect(prompt).not.toHaveBeenCalled()
      expect(proc.signals).toHaveLength(0)
    })

    it('`start anyway` proceeds without a takeover', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const result = await takeOverDevServer(buildDir, { interactive: true, prompt: async () => 'start-anyway' })
      expect(result).toMatchObject({ action: 'start-anyway' })
      expect(proc.signals).toHaveLength(0)
      expect(readLock(buildDir)?.pid).toBe(HOLDER_PID)
    })
  })

  describe('performing the takeover', () => {
    it('marks the lock so the outgoing process can explain itself', async () => {
      writeLock(buildDir)
      mockProcess()
      await takeOverDevServer(buildDir, { interactive: false })
      expect(readLock(buildDir)?.takenOverBy).toBe(process.pid)
    })

    it('escalates to SIGKILL when SIGTERM is ignored', async () => {
      writeLock(buildDir)
      const proc = mockProcess({ diesOn: 'SIGKILL' })
      expect(await takeOverDevServer(buildDir, { interactive: false, timeouts: { graceful: 200, force: 200 } }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGKILL']])
    })

    it('refuses to start when the port is still held after the deadline', async () => {
      writeLock(buildDir)
      const proc = mockProcess({ diesOn: 'never' })
      expect(await takeOverDevServer(buildDir, { interactive: false, timeouts: { graceful: 200, force: 200 } }))
        .toMatchObject({ action: 'refused', reason: 'timeout' })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGKILL']])
    })

    it('also signals the supervising process of a dev fork', async () => {
      writeLock(buildDir, { parentPid: 424243 })
      const proc = mockProcess()
      await takeOverDevServer(buildDir, { interactive: false })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM'], [424243, 'SIGTERM']])
    })
  })

  describe('formatTakeoverRefusal', () => {
    const lock: LockInfo = {
      pid: HOLDER_PID,
      startedAt: Date.now(),
      command: 'dev',
      cwd: '/my/project',
      interactive: true,
      port: 3000,
      url: 'http://localhost:3000',
    }

    it('explains an interactive holder and how to override it', () => {
      const message = formatTakeoverRefusal(lock, 'holder-interactive')
      expect(message).toContain('http://localhost:3000')
      expect(message).toContain('/my/project')
      expect(message).toContain('in a terminal')
      expect(message).toContain('--takeover')
      expect(message).toContain('NUXT_IGNORE_LOCK=1')
    })

    it('does not print `undefined` for a server without a URL yet', () => {
      const message = formatTakeoverRefusal({ ...lock, url: undefined }, 'declined')
      expect(message).not.toContain('undefined')
      expect(message).toContain('no URL yet')
    })

    it('explains a holder that would not exit', () => {
      const message = formatTakeoverRefusal(lock, 'timeout')
      expect(message).toContain('did not exit')
      expect(message).not.toContain('--takeover')
    })
  })

  describe('outgoing side', () => {
    it('reports the takeover to the process being taken over', async () => {
      const { getTakeoverPid } = await import('../../src/utils/lockfile')
      updateLock(buildDir, { command: 'dev', cwd: '/project', port: 3000 })
      markTakenOver(buildDir, HOLDER_PID)
      expect(getTakeoverPid(buildDir)).toBe(HOLDER_PID)
    })

    it('does not annotate a lock owned by the taking-over process', () => {
      writeLock(buildDir)
      markTakenOver(buildDir, HOLDER_PID)
      expect(readLock(buildDir)?.takenOverBy).toBeUndefined()
    })
  })
})
