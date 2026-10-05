import type { TakeoverChoice } from '../../src/dev/takeover'
import type { LockInfo } from '../../src/utils/lockfile'

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkPort = vi.hoisted(() => vi.fn<(port: number, host?: string) => Promise<number | false>>())

vi.mock('get-port-please', () => ({ checkPort }))

const { formatTakeoverRefusal, takeOverServer } = await import('../../src/dev/takeover')
const { logger } = await import('../../src/utils/logger')
const { getTakeoverPid, markTakenOver, readLock, updateLock } = await import('../../src/utils/lockfile')

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

describe('takeOverServer', () => {
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
    expect(await takeOverServer(buildDir)).toEqual({ action: 'none' })
  })

  it('does nothing when locking is disabled', async () => {
    process.env.NUXT_IGNORE_LOCK = '1'
    writeLock(buildDir)
    expect(await takeOverServer(buildDir)).toEqual({ action: 'none' })
  })

  it('never takes over a build lock', async () => {
    writeLock(buildDir, { command: 'build', port: undefined, url: undefined })
    mockProcess()
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'none' })
  })

  it('never takes over when an explicit port differs from the holder\'s', async () => {
    writeLock(buildDir)
    const proc = mockProcess()
    expect(await takeOverServer(buildDir, { requestedPort: 4000, interactive: false })).toEqual({ action: 'none' })
    expect(proc.signals).toHaveLength(0)
    expect(readLock(buildDir)).toBeDefined()
  })

  it('drops a stale lock even when a different port was requested', async () => {
    writeLock(buildDir)
    checkPort.mockResolvedValue(3000)
    mockProcess()
    expect(await takeOverServer(buildDir, { requestedPort: 4000, interactive: false })).toEqual({ action: 'stale' })
    expect(readLock(buildDir)).toBeUndefined()
  })

  it('leaves a lock that was replaced while it was inspected', async () => {
    writeLock(buildDir)
    checkPort.mockResolvedValue(3000)
    mockProcess({ alive: false })
    checkPort.mockImplementation(async () => {
      writeLock(buildDir, { pid: 555555, startedAt: Date.now() + 1 })
      return 3000
    })
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(readLock(buildDir)).toMatchObject({ pid: 555555 })
  })

  it('takes over when the explicit port matches the holder\'s', async () => {
    writeLock(buildDir)
    mockProcess()
    expect(await takeOverServer(buildDir, { requestedPort: 3000, interactive: false }))
      .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
  })

  it('reports a stale lock when the holder is dead', async () => {
    writeLock(buildDir)
    const proc = mockProcess({ alive: false })
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(proc.signals).toHaveLength(0)
    expect(readLock(buildDir)).toBeUndefined()
  })

  it('warns when the holder is gone but its port is still taken', async () => {
    writeLock(buildDir)
    mockProcess({ alive: false })
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('still listening'))
  })

  it('does not warn when the holder is gone and its port is free', async () => {
    writeLock(buildDir)
    checkPort.mockResolvedValue(3000)
    mockProcess({ alive: false })
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a stale lock when the port is free (recycled PID)', async () => {
    writeLock(buildDir)
    checkPort.mockResolvedValue(3000)
    const proc = mockProcess()
    expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'stale' })
    expect(proc.signals).toHaveLength(0)
    expect(readLock(buildDir)).toBeUndefined()
  })

  describe('decision matrix', () => {
    it('non-interactive holder, non-interactive caller: takes over', async () => {
      writeLock(buildDir, { interactive: false })
      const proc = mockProcess()
      expect(await takeOverServer(buildDir, { interactive: false }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM']])
    })

    it('non-interactive holder, interactive caller: prompts, defaulting to takeover', async () => {
      writeLock(buildDir, { interactive: false })
      mockProcess()
      const prompt = vi.fn(async (_lock: LockInfo, fallback: TakeoverChoice) => fallback)
      const result = await takeOverServer(buildDir, { interactive: true, prompt })
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ pid: HOLDER_PID }), 'takeover')
      expect(result).toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
    })

    it('interactive holder, non-interactive caller: refuses', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const result = await takeOverServer(buildDir, { interactive: false })
      expect(result).toMatchObject({ action: 'refused', reason: 'holder-interactive' })
      expect(proc.signals).toHaveLength(0)
    })

    it('interactive holder, interactive caller: prompts, defaulting to not starting', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const prompt = vi.fn(async (_lock: LockInfo, fallback: TakeoverChoice) => fallback)
      const result = await takeOverServer(buildDir, { interactive: true, prompt })
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
      expect(await takeOverServer(buildDir, { takeover: true, interactive: true, prompt }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(prompt).not.toHaveBeenCalled()
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM']])
    })

    it('`--no-takeover` refuses without signalling anything', async () => {
      writeLock(buildDir, { interactive: false })
      const proc = mockProcess()
      const prompt = vi.fn(async () => 'takeover' as const)
      expect(await takeOverServer(buildDir, { takeover: false, interactive: true, prompt }))
        .toMatchObject({ action: 'refused', reason: 'disabled' })
      expect(prompt).not.toHaveBeenCalled()
      expect(proc.signals).toHaveLength(0)
    })

    it('`start anyway` proceeds without a takeover', async () => {
      writeLock(buildDir, { interactive: true })
      const proc = mockProcess()
      const result = await takeOverServer(buildDir, { interactive: true, prompt: async () => 'start-anyway' })
      expect(result).toMatchObject({ action: 'start-anyway' })
      expect(proc.signals).toHaveLength(0)
      expect(readLock(buildDir)?.pid).toBe(HOLDER_PID)
    })
  })

  describe('performing the takeover', () => {
    it('marks the lock so the outgoing process can explain itself', async () => {
      writeLock(buildDir)
      mockProcess()
      await takeOverServer(buildDir, { interactive: false })
      expect(readLock(buildDir)?.takenOverBy).toBe(process.pid)
    })

    it('escalates to SIGKILL when SIGTERM is ignored', async () => {
      writeLock(buildDir)
      const proc = mockProcess({ diesOn: 'SIGKILL' })
      expect(await takeOverServer(buildDir, { interactive: false, timeouts: { graceful: 200, force: 200 } }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGKILL']])
    })

    it('refuses to start when the port is still held after the deadline', async () => {
      writeLock(buildDir)
      const proc = mockProcess({ diesOn: 'never' })
      expect(await takeOverServer(buildDir, { interactive: false, timeouts: { graceful: 200, force: 200 } }))
        .toMatchObject({ action: 'refused', reason: 'timeout' })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGKILL']])
    })

    it('leaves the holder identifiable after giving up', async () => {
      writeLock(buildDir)
      mockProcess({ diesOn: 'never' })
      await takeOverServer(buildDir, { interactive: false, timeouts: { graceful: 200, force: 200 } })
      const lock = readLock(buildDir)
      expect(lock?.pid).toBe(HOLDER_PID)
      expect(lock?.takenOverBy).toBeUndefined()
    })

    it('also signals the supervising process of a dev fork', async () => {
      writeLock(buildDir, { parentPid: 424243 })
      const proc = mockProcess()
      await takeOverServer(buildDir, { interactive: false })
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

    it('names a preview server, and runs a second one on another port rather than ignoring the lock', () => {
      const message = formatTakeoverRefusal({ ...lock, command: 'preview' }, 'holder-interactive')
      expect(message).toContain('Another Nuxt preview server is already running')
      expect(message).toContain('`--port` to run a second one alongside it')
      expect(message).not.toContain('NUXT_IGNORE_LOCK')
    })

    it('names a preview server that would not exit', () => {
      expect(formatTakeoverRefusal({ ...lock, command: 'preview' }, 'timeout'))
        .toContain('The preview server on port 3000 did not exit')
    })
  })

  describe('preview servers', () => {
    it('check every interface for a server that recorded no hostname', async () => {
      writeLock(buildDir, { command: 'preview', hostname: undefined })
      mockProcess()
      await takeOverServer(buildDir, { command: 'preview', interactive: false })
      expect(checkPort).toHaveBeenCalledWith(3000, undefined)
    })

    it('check only the recorded hostname for a server that bound one', async () => {
      writeLock(buildDir, { command: 'preview', hostname: '127.0.0.1' })
      mockProcess()
      checkPort.mockClear()
      await takeOverServer(buildDir, { command: 'preview', interactive: false })
      expect(checkPort).toHaveBeenCalledWith(3000, '127.0.0.1')
      expect(checkPort).not.toHaveBeenCalledWith(3000, undefined)
    })

    it('are only taken over by a preview', async () => {
      writeLock(buildDir, { command: 'preview' })
      const proc = mockProcess()
      expect(await takeOverServer(buildDir, { interactive: false })).toEqual({ action: 'none' })
      expect(proc.signals).toHaveLength(0)
    })

    it('never let a preview take over a dev server', async () => {
      writeLock(buildDir, { command: 'dev' })
      const proc = mockProcess()
      expect(await takeOverServer(buildDir, { command: 'preview', interactive: false })).toEqual({ action: 'none' })
      expect(proc.signals).toHaveLength(0)
    })

    it('follow the same decision matrix as dev servers', async () => {
      writeLock(buildDir, { command: 'preview', interactive: true })
      mockProcess()
      expect(await takeOverServer(buildDir, { command: 'preview', interactive: false }))
        .toMatchObject({ action: 'refused', reason: 'holder-interactive' })

      writeLock(buildDir, { command: 'preview', interactive: false })
      expect(await takeOverServer(buildDir, { command: 'preview', interactive: false }))
        .toEqual({ action: 'taken', port: 3000, pid: HOLDER_PID })
    })

    it('stop the server process a preview runs as well as the preview itself', async () => {
      writeLock(buildDir, { command: 'preview', serverPid: 434343 })
      const proc = mockProcess()
      await takeOverServer(buildDir, { command: 'preview', interactive: false })
      expect(proc.signals).toEqual([[434343, 'SIGTERM'], [HOLDER_PID, 'SIGTERM']])
    })

    it.each(['removed', 'replaced', 'free'])('does not signal a preview whose lock is %s while prompting', async (change) => {
      writeLock(buildDir, { command: 'preview', serverPid: 434343 })
      const proc = mockProcess()
      const result = await takeOverServer(buildDir, {
        command: 'preview',
        interactive: true,
        prompt: async () => {
          if (change === 'removed') {
            unlinkSync(join(buildDir, 'nuxt.lock'))
          }
          else if (change === 'replaced') {
            writeLock(buildDir, { command: 'preview', pid: 555555 })
          }
          else {
            checkPort.mockResolvedValue(3000)
          }
          return 'takeover'
        },
      })
      expect(result.action).toBe(change === 'free' ? 'stale' : 'none')
      expect(proc.signals).toHaveLength(0)
      if (change === 'replaced') {
        expect(readLock(buildDir)).toMatchObject({ pid: 555555 })
        expect(readLock(buildDir)?.takenOverBy).toBeUndefined()
      }
    })

    it('does not signal a child removed from the lock while prompting', async () => {
      const lock = writeLock(buildDir, { command: 'preview', serverPid: 434343 })
      const proc = mockProcess()
      await takeOverServer(buildDir, {
        command: 'preview',
        interactive: true,
        prompt: async () => {
          writeLock(buildDir, { ...lock, serverPid: undefined })
          return 'takeover'
        },
      })
      expect(proc.signals).toEqual([[HOLDER_PID, 'SIGTERM']])
    })

    it('does not escalate against a preview whose lock was released', async () => {
      writeLock(buildDir, { command: 'preview', serverPid: 434343 })
      const proc = mockProcess({ diesOn: 'never' })
      proc.kill.mockImplementation((pid, signal) => {
        if (signal === 'SIGTERM') {
          proc.signals.push([pid as number, signal])
          unlinkSync(join(buildDir, 'nuxt.lock'))
        }
        return true as never
      })
      expect(await takeOverServer(buildDir, {
        command: 'preview',
        takeover: true,
        timeouts: { graceful: 1, force: 1 },
      })).toMatchObject({ action: 'refused', reason: 'timeout' })
      expect(proc.signals).toEqual([[434343, 'SIGTERM']])
    })

    it('can be started alongside without a warning about the build directory', async () => {
      writeLock(buildDir, { command: 'preview', interactive: true })
      mockProcess()
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      expect(await takeOverServer(buildDir, { command: 'preview', interactive: true, prompt: async () => 'start-anyway' }))
        .toMatchObject({ action: 'start-anyway' })
      expect(warn).not.toHaveBeenCalled()
    })

    it('are named when stale', async () => {
      writeLock(buildDir, { command: 'preview' })
      mockProcess({ alive: false })
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      expect(await takeOverServer(buildDir, { command: 'preview', interactive: false })).toEqual({ action: 'stale' })
      expect(warn).toHaveBeenCalledWith('The preview server that was using port 3000 is gone, but something is still listening there.')
    })
  })

  describe('outgoing side', () => {
    it('reports the takeover to the process being taken over', () => {
      vi.spyOn(process, 'kill').mockImplementation(() => true as never)
      updateLock(buildDir, { command: 'dev', cwd: '/project', port: 3000 })
      markTakenOver(buildDir, HOLDER_PID)
      expect(getTakeoverPid(buildDir)).toBe(HOLDER_PID)
    })

    it('does not report a handover to a process that has since exited', () => {
      updateLock(buildDir, { command: 'dev', cwd: '/project', port: 3000 })
      markTakenOver(buildDir, 999999999)
      expect(getTakeoverPid(buildDir)).toBeUndefined()
    })

    it('does not annotate a lock owned by the taking-over process', () => {
      writeLock(buildDir)
      markTakenOver(buildDir, HOLDER_PID)
      expect(readLock(buildDir)?.takenOverBy).toBeUndefined()
    })
  })
})
