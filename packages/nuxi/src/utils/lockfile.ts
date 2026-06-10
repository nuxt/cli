import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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

// Presence markers live one-file-per-process under `<buildDir>/locks/<pid>.json`.
// A single shared `nuxt.lock` cannot represent more than one owner: peer dev
// servers sharing a buildDir would clobber each other's record on acquire,
// `updateLock` would no-op for every non-owner, and whichever server exited
// first would unlink the file out from under the others. Per-process files
// remove all three hazards — each process only ever writes or removes its own
// path, so reads simply enumerate the directory.
const LOCKS_DIRNAME = 'locks'
// PID recycling safety net. Locks older than this cannot be trusted because a
// recycled PID could match a dead build's record.
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000

export function locksDir(buildDir: string): string {
  return join(buildDir, LOCKS_DIRNAME)
}

export function lockPathFor(buildDir: string, pid: number): string {
  return join(locksDir(buildDir), `${pid}.json`)
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
 * Enumerate the live markers in a buildDir, newest first. Stale, dead, or
 * corrupted files are pruned as a side effect so the directory self-cleans.
 * Markers owned by the current process are excluded (a process never blocks or
 * detects itself).
 */
export function readActiveLocks(buildDir: string): LockInfo[] {
  const dir = locksDir(buildDir)
  let names: string[]
  try {
    names = readdirSync(dir)
  }
  catch {
    return []
  }
  const active: LockInfo[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue
    }
    const lockPath = join(dir, name)
    const info = readLockFile(lockPath)
    if (!info || info.pid === process.pid) {
      continue
    }
    if (isLockActive(info)) {
      active.push(info)
    }
    else {
      // Dead/stale/corrupted marker: prune so the directory doesn't accumulate.
      tryUnlink(lockPath)
    }
  }
  return active.sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * Read a single representative active lock for a buildDir, or `undefined` when
 * none is live. A build lock wins (it is exclusive); otherwise the most-recently
 * started dev server. Use {@link readActiveLocks} when every owner matters.
 */
export function readActiveLock(buildDir: string): LockInfo | undefined {
  const active = readActiveLocks(buildDir)
  return active.find(l => l.command === 'build') ?? active[0]
}

type LockResult
  = | { existing?: undefined, release: () => void }
    | { existing: LockInfo, release?: undefined }

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

/**
 * Acquire a build/dev lock. Returns `{ existing }` when a conflicting live lock
 * blocks us, otherwise `{ release }` to invoke on shutdown. The marker is always
 * written for detection. With `enforce` false (used by `nuxt dev`) peer dev
 * servers coexist — only an active `build` is refused. With `enforce` true
 * (`nuxt build`) any other live owner is refused. `enforce` defaults to
 * `isLockEnabled()`. No-op when writing is disabled.
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
  const lockPath = lockPathFor(buildDir, process.pid)
  const token = `${process.pid}:${++acquireCounter}`
  const fullInfo: LockInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    ...info,
    token,
  }

  // The locks dir may not exist yet (e.g. `rimraf .nuxt && nuxt dev`); the lock
  // is acquired before `clearBuildDir` runs, so create it lazily.
  try {
    mkdirSync(locksDir(buildDir), { recursive: true })
  }
  catch {}

  // A build is exclusive, so it refuses any other live owner; a dev refuses only
  // an active build (peer dev servers are allowed to share the buildDir).
  const others = readActiveLocks(buildDir)
  const blocker = enforce ? others[0] : others.find(l => l.command === 'build')
  if (blocker) {
    return { existing: blocker }
  }

  // Overwrite our own marker (a same-process re-acquire on reload is expected).
  writeFileSync(lockPath, JSON.stringify(fullInfo, null, 2))
  return { release: makeRelease(lockPath, token) }
}

/**
 * Overwrite this process's own marker with updated metadata (e.g. port
 * information learned after the listener binds, or toggling `typesReady`).
 * Callers must hold the lock via a prior successful `acquireLock`. Unlike the
 * old shared-file design this always updates our own marker regardless of peer
 * dev servers. Does nothing when locking is disabled.
 */
export function updateLock(
  buildDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt' | 'token'>,
): void {
  if (!isLockWriteEnabled()) {
    return
  }
  const lockPath = lockPathFor(buildDir, process.pid)
  const current = readLockFile(lockPath)
  // A recycled PID could leave a foreign file at our path; never adopt it.
  if (current && current.pid !== process.pid) {
    return
  }
  // Merge so a partial update keeps existing fields (url, port, …) and the
  // original acquisition's token survives for its release.
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
