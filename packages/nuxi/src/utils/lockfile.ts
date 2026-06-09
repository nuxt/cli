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
  /**
   * `true` once the dev server has finished `writeTypes`/`buildNuxt` for the
   * current Nuxt instance, i.e. `.nuxt` types are current. Cleared while
   * (re)building. `nuxt typecheck` only reuses `.nuxt` when this is set, so it
   * never checks against stale or mid-rebuild generated types.
   */
  typesReady?: boolean
  /**
   * Unique per `acquireLock` call within a process. Lets a release only remove
   * the marker it actually wrote, so a same-process re-acquire (e.g. dev reload)
   * isn't clobbered by the previous acquisition's release.
   */
  token?: string
}

// Monotonic per-process counter feeding lock tokens; combined with the pid it
// uniquely identifies a single acquisition.
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
 * Default enforcement policy for callers that don't pass `enforce` explicitly:
 * a conflicting live lock makes them refuse to start. On for agents by default;
 * `NUXT_LOCK=1` forces it on for humans, `NUXT_IGNORE_LOCK=1` forces it off.
 * `nuxt dev` opts out (passes `enforce: false`); `nuxt build` uses this default.
 *
 * Independent of {@link isLockWriteEnabled}: the presence marker is still
 * written when enforcement is off so other tooling can detect a running server.
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

/**
 * Whether Nuxt should write the presence lock file at all. Only the explicit
 * `NUXT_IGNORE_LOCK` opt-out disables it; otherwise the marker is always
 * written so other commands (e.g. `nuxt typecheck`) can detect a live dev
 * server and reuse its prepared `.nuxt`. This is intentionally broader than
 * {@link isLockEnabled}, which only governs conflict *enforcement*.
 */
function isLockWriteEnabled(): boolean {
  return !process.env.NUXT_IGNORE_LOCK
}

type LockResult
  = | { existing?: undefined, release: () => void }
    | { existing: LockInfo, release?: undefined }

/**
 * Acquire a build/dev lock.
 *
 * Two orthogonal roles:
 * - **Presence**: the marker is written whenever {@link isLockWriteEnabled}, so
 *   other commands (e.g. `typecheck`) can detect a live process via
 *   {@link readActiveLock}.
 * - **Enforcement**: when `enforce` is set, a conflicting live lock makes us
 *   refuse (returns `{ existing }`). `nuxt dev` passes `enforce: false` so
 *   multiple dev servers may run concurrently — the lock there is purely a
 *   detection signal. `nuxt build` keeps enforcement (parallel builds clobber
 *   output). Defaults to {@link isLockEnabled} when unspecified.
 */
export function acquireLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt'>,
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
    token,
    ...info,
  }

  // The build dir may not exist yet (e.g. `rimraf .nuxt && nuxt dev`); the
  // lock is acquired before `clearBuildDir` runs, so create it lazily.
  try {
    mkdirSync(buildDir, { recursive: true })
  }
  catch {}

  if (!enforce) {
    // Detection-only for peer dev servers: claim the marker, never refuse a
    // concurrent dev. But never clobber an active `build` — builds mutate the
    // buildDir and must not run alongside dev. When several dev servers share a
    // buildDir the most recent one is advertised; `makeRelease` only removes
    // the file while it still carries our token.
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
  info: Omit<LockInfo, 'pid' | 'startedAt'>,
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
  const next: LockInfo = {
    // Merge over the existing marker so partial updates (e.g. just toggling
    // `typesReady`) keep previously-written fields like `url`/`port`.
    ...current,
    ...info,
    pid: process.pid,
    startedAt: current?.startedAt ?? Date.now(),
    // Preserve the acquiring call's token so its release still matches.
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
    // Only remove the marker if it still carries our token. A same-process
    // re-acquire (dev reload) writes a new token, so an earlier release must
    // not delete the newer acquisition's file.
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
