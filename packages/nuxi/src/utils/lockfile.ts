import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { join } from 'pathe'
import { isAgent } from 'std-env'

interface LockInfo {
  pid: number
  startedAt: number
  command: 'dev' | 'build'
  cwd: string
  port?: number
  hostname?: string
  url?: string
}

const LOCK_FILENAME = 'nuxt.lock'
// PID recycling safety net. Locks older than this cannot be trusted because a
// recycled PID could match a dead build's record.
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000

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
 * Locking is enabled for agents by default. `NUXT_LOCK=1` forces it on for
 * non-agents; `NUXT_IGNORE_LOCK=1` forces it off.
 */
export function isLockEnabled(): boolean {
  if (process.env.NUXT_IGNORE_LOCK) {
    return false
  }
  if (process.env.NUXT_LOCK === '1' || process.env.NUXT_LOCK === 'true') {
    return true
  }
  return isAgent
}

type LockResult
  = | { existing?: undefined, release: () => void }
    | { existing: LockInfo, release?: undefined }

/**
 * Atomically acquire a build/dev lock.
 * Returns `{ existing }` if another live process holds the lock, otherwise
 * `{ release }` to be invoked on shutdown. No-op when locking is disabled.
 */
export function acquireLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt'>,
): LockResult {
  if (!isLockEnabled()) {
    return { release: () => {} }
  }

  const lockPath = join(buildDir, LOCK_FILENAME)
  const fullInfo: LockInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    ...info,
  }

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
      if (existing && isLockActive(existing)) {
        return { existing }
      }
      // Stale, corrupted, or self-owned; remove and retry.
      tryUnlink(lockPath)
    }
  }

  // Two failures in a row; surface whatever we can read.
  const existing = readLockFile(lockPath)
  if (existing && isLockActive(existing)) {
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
  info: Omit<LockInfo, 'pid' | 'startedAt'>,
): void {
  if (!isLockEnabled()) {
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
