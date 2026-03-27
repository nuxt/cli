import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'

import { dirname, join } from 'pathe'
import { isAgent } from 'std-env'

interface LockInfo {
  pid: number
  startedAt: number
  command: 'dev' | 'build'
  port?: number
  hostname?: string
  url?: string
}

const LOCK_FILENAME = 'nuxt.lock'

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

function readLockFile(lockPath: string): LockInfo | undefined {
  try {
    const content = readFileSync(lockPath, 'utf-8')
    return JSON.parse(content) as LockInfo
  }
  catch {
    return undefined
  }
}

function isLockEnabled(): boolean {
  return isAgent && !process.env.NUXT_IGNORE_LOCK
}

/**
 * Check if a Nuxt process is already running for this project.
 * Only active when running inside an AI agent environment.
 * Set NUXT_IGNORE_LOCK=1 to bypass.
 * Stale lock files (from crashed processes) are automatically cleaned up.
 */
export function checkLock(buildDir: string): LockInfo | undefined {
  if (!isLockEnabled()) {
    return undefined
  }

  const lockPath = join(buildDir, LOCK_FILENAME)

  if (!existsSync(lockPath)) {
    return undefined
  }

  const info = readLockFile(lockPath)
  if (!info) {
    try {
      unlinkSync(lockPath)
    }
    catch {}
    return undefined
  }

  if (!isProcessAlive(info.pid)) {
    try {
      unlinkSync(lockPath)
    }
    catch {}
    return undefined
  }

  // Don't block ourselves (fork pool scenario)
  if (info.pid === process.pid) {
    return undefined
  }

  return info
}

/**
 * Write a lock file. Returns a cleanup function.
 * Only writes when running inside an AI agent environment.
 */
export async function writeLock(buildDir: string, info: LockInfo): Promise<() => void> {
  const noop = () => {}
  if (!isLockEnabled()) {
    return noop
  }

  const lockPath = join(buildDir, LOCK_FILENAME)

  await mkdir(dirname(lockPath), { recursive: true })
  writeFileSync(lockPath, JSON.stringify(info, null, 2))

  let cleaned = false
  function cleanup() {
    if (cleaned)
      return
    cleaned = true
    try {
      unlinkSync(lockPath)
    }
    catch {}
  }

  process.on('exit', cleanup)
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      cleanup()
      process.exit()
    })
  }

  return cleanup
}

/**
 * Format an error message when a Nuxt process is already running.
 * Designed to be actionable for both humans and LLM agents.
 */
export function formatLockError(info: LockInfo, cwd: string): string {
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
  lines.push(`  Dir:     ${cwd}`)
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
