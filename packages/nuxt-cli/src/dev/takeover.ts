import type { LockInfo } from '../utils/lockfile'

import process from 'node:process'

import { cancel, isCancel, select } from '@clack/prompts'
import { checkPort } from 'get-port-please'
import colors from 'picocolors'

import { restoreRawMode } from '../utils/console'
import { isInteractiveSession, isLockEnabled, markTakenOver, readLock } from '../utils/lockfile'
import { logger } from '../utils/logger'

/** How long the outgoing dev server has to exit and release its port. */
const TAKEOVER_TIMEOUT_MS = 5000
/** How long a `SIGKILL`ed process has to disappear before we give up. */
const TAKEOVER_KILL_TIMEOUT_MS = 1000
const TAKEOVER_POLL_INTERVAL_MS = 100

export type TakeoverRefusalReason
  /** The holder was started in a terminal and we cannot ask this user. */
  = | 'holder-interactive'
  /** The user declined at the prompt. */
    | 'declined'
  /** `--no-takeover` was passed. */
    | 'disabled'
  /** The holder ignored both signals, or something else still has the port. */
    | 'timeout'

export type TakeoverResult
  /** Nothing to take over, or nothing we are willing to touch. */
  = | { action: 'none' }
  /** A lock was found but its owner is gone; it will be cleaned up on acquire. */
    | { action: 'stale' }
  /** The previous server is gone and its port is ours. */
    | { action: 'taken', port: number, pid: number }
  /** The caller should print `formatTakeoverRefusal` and exit non-zero. */
    | { action: 'refused', existing: LockInfo, reason: TakeoverRefusalReason }
  /** The user chose to run a second server anyway, without the lock. */
    | { action: 'start-anyway', existing: LockInfo }

export type TakeoverChoice = 'takeover' | 'abort' | 'start-anyway'

export interface TakeoverOptions {
  /** Port this invocation was explicitly asked to use, if any. */
  requestedPort?: number
  /** `--takeover` / `--no-takeover`; either skips the prompt. */
  takeover?: boolean
  /** Whether this invocation can prompt. Defaults to the current terminal. */
  interactive?: boolean
  /** Overridable so the decision table can be tested without a TTY. */
  prompt?: (existing: LockInfo, defaultChoice: TakeoverChoice) => Promise<TakeoverChoice>
  /** How long to wait for the outgoing server, in ms. Overridable for tests. */
  timeouts?: { graceful?: number, force?: number }
}

/**
 * Decide what to do about an existing dev server on this build directory, and
 * carry out a takeover if that is the answer.
 *
 * Must be called before anything binds a port or writes to the build directory,
 * because a takeover adopts the port the outgoing server was using.
 */
export async function takeOverDevServer(buildDir: string, options: TakeoverOptions = {}): Promise<TakeoverResult> {
  if (!isLockEnabled('dev')) {
    return { action: 'none' }
  }

  const existing = readLock(buildDir)
  if (!existing || existing.pid === process.pid) {
    return { action: 'none' }
  }

  // Signalling a `build` is never on the table, and neither is a server on a
  // port we were not asked for: an explicit `--port` that differs means the user
  // wants a second server.
  if (existing.command !== 'dev' || !existing.port) {
    return { action: 'none' }
  }
  if (options.requestedPort !== undefined && options.requestedPort !== existing.port) {
    return { action: 'none' }
  }

  if (!isProcessAlive(existing.pid)) {
    return { action: 'stale' }
  }

  // An alive PID with a free port means the PID was recycled inside the lock's
  // trust window and belongs to an unrelated process. Signalling it would kill
  // a stranger.
  if (await isPortFree(existing.port, existing.hostname)) {
    return { action: 'stale' }
  }

  if (options.takeover === false) {
    return { action: 'refused', existing, reason: 'disabled' }
  }

  if (options.takeover !== true) {
    const interactive = options.interactive ?? isInteractiveSession()
    // The holder's flag can be stale: a server started in a terminal that has
    // since closed still claims to be interactive. That is deliberate. Such a
    // process is usually SIGHUPed (and then fails the checks above), and for a
    // `nohup`ed survivor refusing to kill it is the right default, with
    // `--takeover` as the way out.
    if (!interactive) {
      if (existing.interactive) {
        return { action: 'refused', existing, reason: 'holder-interactive' }
      }
    }
    else {
      const prompt = options.prompt ?? promptForTakeover
      // Nothing ends an interactive session on a bare enter, so the default
      // depends on whether a person is watching the other server.
      const choice = await prompt(existing, existing.interactive ? 'abort' : 'takeover')
      if (choice === 'abort') {
        return { action: 'refused', existing, reason: 'declined' }
      }
      if (choice === 'start-anyway') {
        logger.warn(`Starting a second dev server: both will write to ${colors.cyan(buildDir)}, which is unsupported and may corrupt the build.`)
        return { action: 'start-anyway', existing }
      }
    }
  }

  return performTakeover(buildDir, existing, options.timeouts)
}

async function performTakeover(buildDir: string, existing: LockInfo, timeouts: TakeoverOptions['timeouts'] = {}): Promise<TakeoverResult> {
  const port = existing.port!
  const startedAt = new Date(existing.startedAt).toLocaleTimeString()
  logger.info(`Taking over the dev server on port ${port} (PID ${existing.pid}, started ${startedAt}).`)

  markTakenOver(buildDir, process.pid)

  const pids = existing.parentPid && existing.parentPid !== existing.pid
    ? [existing.pid, existing.parentPid]
    : [existing.pid]

  // On Windows `SIGTERM` is not delivered as a signal and terminates the process
  // outright, so the graceful window below simply passes quickly there.
  signalAll(pids, 'SIGTERM')
  if (await waitForRelease(pids, port, existing.hostname, timeouts.graceful ?? TAKEOVER_TIMEOUT_MS)) {
    return { action: 'taken', port, pid: existing.pid }
  }

  signalAll(pids, 'SIGKILL')
  if (await waitForRelease(pids, port, existing.hostname, timeouts.force ?? TAKEOVER_KILL_TIMEOUT_MS)) {
    return { action: 'taken', port, pid: existing.pid }
  }

  return { action: 'refused', existing, reason: 'timeout' }
}

/** Human-readable explanation for a refusal, including how to override it. */
export function formatTakeoverRefusal(existing: LockInfo, reason: TakeoverRefusalReason): string {
  const location = existing.url ? existing.url : 'starting up (no URL yet)'
  const lines = [
    '',
    reason === 'timeout'
      ? `The dev server on port ${existing.port} did not exit, so this one will not start.`
      : 'Another Nuxt dev server is already running:',
    '',
    `  URL:     ${location}`,
    `  PID:     ${existing.pid}`,
    `  Dir:     ${existing.cwd}`,
    `  Started: ${new Date(existing.startedAt).toLocaleString()}${existing.interactive ? ' (in a terminal)' : ''}`,
    '',
  ]

  if (reason === 'holder-interactive') {
    lines.push('It was started interactively, so it is not stopped automatically.')
  }
  if (reason !== 'timeout') {
    lines.push('Pass `--takeover` to stop it and start this server in its place, or `NUXT_IGNORE_LOCK=1` to run a second server (unsupported).')
  }
  lines.push('')

  return lines.join('\n')
}

async function promptForTakeover(existing: LockInfo, defaultChoice: TakeoverChoice): Promise<TakeoverChoice> {
  const location = existing.url || 'starting up (no URL yet)'
  const choice = await select<TakeoverChoice>({
    message: `A Nuxt dev server is already running here (PID ${existing.pid}, ${location}). What would you like to do?`,
    initialValue: defaultChoice,
    options: [
      { value: 'takeover', label: `Take over port ${existing.port}`, hint: 'stops the running server (--takeover)' },
      { value: 'abort', label: 'Do not start', hint: '--no-takeover' },
      { value: 'start-anyway', label: 'Start anyway', hint: 'unsupported: both servers share the build directory' },
    ],
  })
  restoreRawMode()
  // Ctrl-C must never be the thing that stops the other server.
  if (isCancel(choice)) {
    cancel('Not starting a second dev server.')
    return 'abort'
  }
  return choice
}

function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    }
    catch {}
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function isPortFree(port: number, hostname?: string): Promise<boolean> {
  return await checkPort(port, hostname || 'localhost') !== false
}

async function waitForRelease(pids: number[], port: number, hostname: string | undefined, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!pids.some(isProcessAlive) && await isPortFree(port, hostname)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, TAKEOVER_POLL_INTERVAL_MS))
  }
  return false
}
