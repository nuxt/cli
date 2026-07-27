import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { join } from 'pathe'
import { isAgent, isCI } from 'std-env'

export interface LockInfo {
  pid: number
  startedAt: number
  command: 'dev' | 'build'
  cwd: string
  /**
   * Whether the holder was started from a terminal a user is sitting at. Only
   * the holder can know this, so it is recorded here for other invocations to
   * read.
   */
  interactive: boolean
  port?: number
  hostname?: string
  url?: string
  /**
   * PID of the process supervising the holder, when the holder is a dev fork.
   * Signalling the holder alone would leave its supervisor running.
   */
  parentPid?: number
  /** PID of the process that claimed this lock, written before it signals us. */
  takenOverBy?: number
}

const LOCK_FILENAME = 'nuxt.lock'
// PID recycling safety net. Locks older than this cannot be trusted because a
// recycled PID could match a dead build's record.
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000

/** Whether this process is attached to a terminal a user can answer prompts on. */
export function isInteractiveSession(): boolean {
  return !!process.stdin.isTTY && !isCI
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (err) {
    // EPERM means the process exists but we can't signal it (different user).
    // Treat it as alive so we don't clobber locks held by other accounts.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Read the lock held for `buildDir`, if there is one. */
export function readLock(buildDir: string): LockInfo | undefined {
  return readLockFile(join(buildDir, LOCK_FILENAME))
}

/**
 * Record that `byPid` is taking the lock over, so the outgoing holder can
 * explain its own shutdown. Only ever annotates a lock owned by another
 * process, and never creates one.
 */
export function markTakenOver(buildDir: string, byPid: number): void {
  const lockPath = join(buildDir, LOCK_FILENAME)
  const current = readLockFile(lockPath)
  if (!current || current.pid === byPid) {
    return
  }
  try {
    writeFileSync(lockPath, JSON.stringify({ ...current, takenOverBy: byPid }, null, 2))
  }
  catch {}
}

/** PID that claimed our own lock, if this process is being taken over. */
export function getTakeoverPid(buildDir: string): number | undefined {
  const current = readLock(buildDir)
  return current?.pid === process.pid ? current.takenOverBy : undefined
}

function readLockFile(lockPath: string): LockInfo | undefined {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8')) as LockInfo
  }
  catch {
    return undefined
  }
}

function tryUnlink(lockPath: string): void {
  try {
    unlinkSync(lockPath)
  }
  catch {}
}

function isLockActive(info: LockInfo): boolean {
  if (info.pid === process.pid) {
    return false
  }
  if (!isProcessAlive(info.pid)) {
    return false
  }
  if (Date.now() - info.startedAt > MAX_LOCK_AGE_MS) {
    return false
  }
  return true
}

/**
 * Locking is always enabled for `dev`, because two dev servers sharing one
 * build directory corrupt each other's output. `build` locking stays limited to
 * agents. `NUXT_LOCK=1` forces it on, `NUXT_IGNORE_LOCK=1` and `NUXT_LOCK=0`
 * force it off.
 */
export function isLockEnabled(command: LockInfo['command'] = 'dev'): boolean {
  if (process.env.NUXT_IGNORE_LOCK || process.env.NUXT_LOCK === '0' || process.env.NUXT_LOCK === 'false') {
    return false
  }
  if (process.env.NUXT_LOCK === '1' || process.env.NUXT_LOCK === 'true') {
    return true
  }
  return command === 'dev' || isAgent
}

type LockResult
  = | { existing?: undefined, release: () => void }
    | { existing: LockInfo, release?: undefined }

export interface AcquireLockOptions {
  /** PID whose lock may be claimed, for a handover where both processes overlap. */
  takeoverFrom?: number
}

/**
 * Atomically acquire a build/dev lock.
 * Returns `{ existing }` if another live process holds the lock, otherwise
 * `{ release }` to be invoked on shutdown. No-op when locking is disabled.
 */
export function acquireLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt' | 'interactive'>,
  options: AcquireLockOptions = {},
): LockResult {
  if (!isLockEnabled(info.command)) {
    return { release: () => {} }
  }

  const lockPath = join(buildDir, LOCK_FILENAME)
  const fullInfo: LockInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    interactive: isInteractiveSession(),
    ...info,
  }

  // The build dir may not exist yet (e.g. `rimraf .nuxt && nuxt dev`); the
  // lock is acquired before `clearBuildDir` runs, so create it lazily.
  try {
    mkdirSync(buildDir, { recursive: true })
  }
  catch {}

  // Try exclusive-create up to twice: the first attempt may race with a stale
  // lock that we then clean up and retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(fullInfo, null, 2), { flag: 'wx' })
      return { release: makeRelease(lockPath) }
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err
      }
      const existing = readLockFile(lockPath)
      if (existing && existing.pid !== options.takeoverFrom && isLockActive(existing)) {
        return { existing }
      }
      // Stale, corrupted, self-owned, or handed over; remove and retry.
      tryUnlink(lockPath)
    }
  }

  // Two failures in a row; surface whatever we can read.
  const existing = readLockFile(lockPath)
  if (existing && existing.pid !== options.takeoverFrom && isLockActive(existing)) {
    return { existing }
  }
  return { release: () => {} }
}

/**
 * Overwrite an existing lock we already own with updated metadata (e.g. port
 * information learned after the listener binds). Callers must hold the lock
 * via a prior successful `acquireLock`. Does nothing when locking is disabled.
 */
export function updateLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt' | 'interactive'>,
): void {
  if (!isLockEnabled(info.command)) {
    return
  }
  const lockPath = join(buildDir, LOCK_FILENAME)
  const current = readLockFile(lockPath)
  // Only overwrite our own lock; never touch another process's file.
  if (current && current.pid !== process.pid) {
    return
  }
  const next: LockInfo = {
    pid: process.pid,
    startedAt: current?.startedAt ?? Date.now(),
    interactive: isInteractiveSession(),
    takenOverBy: current?.takenOverBy,
    ...info,
  }
  try {
    writeFileSync(lockPath, JSON.stringify(next, null, 2))
  }
  catch {}
}

function makeRelease(lockPath: string): () => void {
  let released = false

  function release(): void {
    if (released) {
      return
    }
    released = true
    process.off('exit', release)
    const current = readLockFile(lockPath)
    if (!current || current.pid === process.pid) {
      tryUnlink(lockPath)
    }
  }

  // `exit` fires on normal termination, including after Node's default signal
  // handling (SIGINT → exit 130) when no custom signal handler runs. We
  // deliberately do not install SIGINT/SIGTERM listeners: that would suppress
  // Node's default signal behavior and other shutdown logic, which was the
  // cause of the earlier review concern.
  process.on('exit', release)

  return release
}

/**
 * Format an error message when a Nuxt process is already running.
 * Designed to be actionable for both humans and LLM agents.
 */
export function formatLockError(info: LockInfo): string {
  const isWindows = process.platform === 'win32'
  const killCmd = isWindows ? `taskkill /PID ${info.pid} /F` : `kill ${info.pid}`
  const label = info.command === 'dev' ? 'dev server' : 'build'

  const lines = [
    '',
    `Another Nuxt ${label} is already running:`,
    '',
  ]

  if (info.url) {
    lines.push(`  URL:     ${info.url}`)
  }
  lines.push(`  PID:     ${info.pid}`)
  lines.push(`  Dir:     ${info.cwd}`)
  lines.push(`  Started: ${new Date(info.startedAt).toLocaleString()}`)
  lines.push('')

  if (info.command === 'dev' && info.url) {
    lines.push(`Run \`${killCmd}\` to stop it, or connect to ${info.url}`)
  }
  else {
    lines.push(`Run \`${killCmd}\` to stop it.`)
  }
  lines.push(`Set NUXT_IGNORE_LOCK=1 to bypass this check.`)
  lines.push('')

  return lines.join('\n')
}
