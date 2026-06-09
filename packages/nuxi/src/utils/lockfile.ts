import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { join } from 'pathe'
import { isAgent } from 'std-env'

export interface LockInfo {
  pid: number
  startedAt: number
  command: 'dev' | 'build'
  cwd: string
  port?: number
  hostname?: string
  url?: string
  /** Set once dev has built types; cleared while (re)building. Gates typecheck reuse. */
  typesReady?: boolean
  /** Identifies one `acquireLock` call so its release only removes its own marker. */
  token?: string
}

let acquireCounter = 0

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
 * Default conflict-enforcement policy. On for agents; `NUXT_LOCK=1` forces it on,
 * `NUXT_IGNORE_LOCK=1` off. `nuxt build` uses this; `nuxt dev` passes `enforce: false`.
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

// The marker is written unless explicitly opted out, even when enforcement is off,
// so other commands (e.g. typecheck) can detect a running dev server.
function isLockWriteEnabled(): boolean {
  return !process.env.NUXT_IGNORE_LOCK
}

type LockResult
  = | { existing?: undefined, release: () => void }
    | { existing: LockInfo, release?: undefined }

/**
 * Acquire a build/dev lock. Returns `{ existing }` when a conflicting live lock
 * blocks us, otherwise `{ release }` to invoke on shutdown. The marker is always
 * written for detection. With `enforce` false (used by `nuxt dev`) a peer dev
 * lock is taken over rather than refused, though an active `build` lock is still
 * refused. `enforce` defaults to `isLockEnabled()`. No-op when writing is disabled.
 */
export function acquireLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt' | 'token'>,
  opts: { enforce?: boolean } = {},
): LockResult {
  if (!isLockWriteEnabled()) {
    return { release: () => {} }
  }

  const enforce = opts.enforce ?? isLockEnabled()
  const lockPath = join(buildDir, LOCK_FILENAME)
  const token = `${process.pid}:${++acquireCounter}`
  const fullInfo: LockInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    ...info,
    token,
  }

  // The build dir may not exist yet (e.g. `rimraf .nuxt && nuxt dev`); the
  // lock is acquired before `clearBuildDir` runs, so create it lazily.
  try {
    mkdirSync(buildDir, { recursive: true })
  }
  catch {}

  if (!enforce) {
    // Peer dev servers may share a buildDir, but an active build mutates it and
    // must not be clobbered.
    const existing = readLockFile(lockPath)
    if (existing && isLockActive(existing) && existing.command === 'build') {
      return { existing }
    }
    writeFileSync(lockPath, JSON.stringify(fullInfo, null, 2))
    return { release: makeRelease(lockPath, token) }
  }

  // Enforcing path: try exclusive-create up to twice (the first attempt may
  // race with a stale lock we then clean up and retry).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(fullInfo, null, 2), { flag: 'wx' })
      return { release: makeRelease(lockPath, token) }
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
 * Read the lock file for a buildDir, returning it only when it belongs to a
 * still-running process. Used by other commands (e.g. `typecheck`) to detect a
 * live `dev`/`build` and reuse its prepared `.nuxt`.
 */
export function readActiveLock(buildDir: string): LockInfo | undefined {
  const info = readLockFile(join(buildDir, LOCK_FILENAME))
  return info && isLockActive(info) ? info : undefined
}

/**
 * Overwrite an existing lock we already own with updated metadata (e.g. port
 * information learned after the listener binds). Callers must hold the lock
 * via a prior successful `acquireLock`. Does nothing when locking is disabled.
 */
export function updateLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt' | 'token'>,
): void {
  if (!isLockWriteEnabled()) {
    return
  }
  const lockPath = join(buildDir, LOCK_FILENAME)
  const current = readLockFile(lockPath)
  // Only overwrite our own lock; never touch another process's file.
  if (current && current.pid !== process.pid) {
    return
  }
  // Merge so a partial update (e.g. toggling `typesReady`) keeps existing fields
  // like `url`, and the original acquisition's token survives for its release.
  const next: LockInfo = {
    ...current,
    ...info,
    pid: process.pid,
    startedAt: current?.startedAt ?? Date.now(),
    token: current?.token,
  }
  try {
    writeFileSync(lockPath, JSON.stringify(next, null, 2))
  }
  catch {}
}

function makeRelease(lockPath: string, token: string): () => void {
  let released = false

  function release(): void {
    if (released) {
      return
    }
    released = true
    process.off('exit', release)
    // A same-process re-acquire (dev reload) writes a new token, so only remove
    // the file if it still carries ours.
    const current = readLockFile(lockPath)
    if (current?.token === token) {
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
