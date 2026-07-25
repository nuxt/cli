import type { Buffer } from 'node:buffer'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type { PackageManager, PackageManagerName } from 'nypm'
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import process from 'node:process'

import { log, S_BAR } from '@clack/prompts'
import { addDependency, installDependencies, packageManagers } from 'nypm'
import colors from 'picocolors'
import { provider } from 'std-env'
import { normalizeSpawnCommand, x } from 'tinyexec'

/** Package managers nypm delegates to corepack, so version pins keep working. */
const COREPACK_PACKAGE_MANAGERS = new Set(['pnpm', 'yarn'])

const TRAILING_DOT_RE = /\.$/
const SURROUNDING_QUOTES_RE = /^"(.*)"$/

const STALL_TIMEOUT = 30_000
const STALL_POLL_INTERVAL = 1_000
const KILL_GRACE_PERIOD = 5_000
const OUTPUT_TAIL_LINES = 30

const IGNORED_BUILDS_RE = /Ignored build scripts:\s*([^\n│]+)/
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[\d;]*[A-Z]/gi

/**
 * Build a full package manager descriptor for `name`, carrying over nypm's own
 * metadata (lockfile and marker files, and the major version it derives command
 * flags from) rather than only the command to run.
 */
export function resolvePackageManagerDescriptor(name: PackageManagerName, version?: string): PackageManager {
  const descriptor = packageManagers.find(pm => pm.name === name)
  const resolvedVersion = version ?? descriptor?.version

  return {
    ...descriptor,
    name,
    command: name,
    version: resolvedVersion,
    majorVersion: resolvedVersion?.split('.')[0] ?? descriptor?.majorVersion,
  }
}

export interface InstallOptions {
  cwd: string
  packageManager: PackageManager
  /** Packages to add. When omitted, the project's existing dependencies are installed. */
  dependencies?: string[]
  dev?: boolean
  workspace?: boolean | string
  /** Called with each line of package manager output as it arrives. */
  onOutput?: (line: string) => void
  /** Called with a status update while the install is running. */
  onStatus?: (message: string) => void
  /** Kills the package manager when aborted, so it is not orphaned on `Ctrl+C`. */
  signal?: AbortSignal
}

export interface InstallResult {
  success: boolean
  /** Combined stdout/stderr of the package manager, trimmed. */
  output: string
  /** The command that was run, for display purposes. */
  command: string
  /** Packages whose build scripts the package manager refused to run. */
  ignoredBuilds: string[]
  /** Human-readable failure reason. Only set when `success` is `false`. */
  error?: string
  /** Set when the package manager binary could not be found. */
  missingPackageManager?: boolean
}

/**
 * Run a package manager install, keeping its output quiet unless it is needed.
 *
 * Output is buffered and returned rather than printed, so a caller can render a
 * spinner and only surface the package manager's noise when the install fails.
 * Standard input is not connected to the child: a
 * package manager that decides to prompt gets EOF and falls back to its default
 * instead of hanging behind a spinner where its question is invisible.
 */
export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const nypmOptions = {
    cwd: options.cwd,
    packageManager: options.packageManager,
    dev: options.dev,
    workspace: options.workspace,
    dry: true,
  }

  const { exec } = options.dependencies?.length
    ? await addDependency(options.dependencies, nypmOptions)
    : await installDependencies(nypmOptions)

  if (!exec) {
    return { success: true, output: '', command: '', ignoredBuilds: [] }
  }

  const args = [...exec.args, ...nonInteractiveArgs(options.packageManager)]
  const [command, commandArgs] = await withCorepack(exec.command, args)

  return await execute(command, commandArgs, options)
}

/**
 * Flags that stop a package manager from asking a question we cannot answer, or
 * from failing on something the user can act on after the fact.
 *
 * We deliberately do not set `CI`: package managers change more than their
 * interactivity when they think they are on CI (pnpm, for one, switches to a
 * frozen lockfile), which would break installs for templates whose lockfile is
 * not perfectly in sync.
 */
export function nonInteractiveArgs(packageManager: PackageManager): string[] {
  if (packageManager.name === 'pnpm') {
    // `confirm-modules-purge` prompts before recreating `node_modules`, and
    // `strict-dep-builds` turns blocked dependency build scripts into a failed
    // install (ERR_PNPM_IGNORED_BUILDS). Unknown config keys are ignored by
    // older pnpm releases, so both are safe to pass unconditionally.
    return ['--config.confirm-modules-purge=false', '--config.strict-dep-builds=false']
  }
  return []
}

export interface InstallLog {
  /** Pass to {@link runInstall} as `onOutput`. */
  onOutput: (line: string) => void
  /** Prints the collected output when it is worth seeing, and drops it otherwise. */
  finish: (result: InstallResult) => void
}

/**
 * Collects a package manager's output and prints it once the install is over: on
 * failure, or on success when `verbose` is set. It is printed as plain gutter
 * lines under whatever the caller reported, and only at the end, so it neither
 * decorates the output as a step of its own nor competes with a spinner for the
 * cursor.
 */
export function createInstallLog({ verbose = false } = {}): InstallLog {
  const lines: string[] = []

  return {
    onOutput: line => lines.push(line),
    finish: (result) => {
      if (result.success && !verbose) {
        return
      }
      const output = (lines.length > 0 ? lines.join('\n') : result.output).trim()
      if (output) {
        log.message(output.split('\n'), { symbol: colors.gray(S_BAR) })
      }
    },
  }
}

const reportedIgnoredBuilds = new Set<string>()

/**
 * The packages from {@link InstallResult.ignoredBuilds} that have not been
 * reported yet in this process, so a chained install (`nuxt init` followed by
 * `nuxt module add`) does not repeat the same warning.
 */
export function takeUnreportedIgnoredBuilds(ignoredBuilds: string[]): string[] {
  const packages = ignoredBuilds.filter(name => !reportedIgnoredBuilds.has(name))
  for (const name of packages) {
    reportedIgnoredBuilds.add(name)
  }
  return packages
}

/** Packages whose build scripts pnpm refused to run, parsed from install output. */
export function getIgnoredBuilds(output: string): string[] {
  const match = output.replace(ANSI_RE, '').match(IGNORED_BUILDS_RE)
  if (!match?.[1]) {
    return []
  }
  return match[1]
    .split(',')
    .map(name => name.trim().replace(TRAILING_DOT_RE, ''))
    .filter(Boolean)
}

/**
 * Whether `command` can be spawned, looked up the way the platform would.
 *
 * Windows spawns go through `cmd.exe`, which reports a missing command as exit
 * code 9009 with a localised message rather than as `ENOENT`, so the check has to
 * happen before the process starts for the failure to be recognisable.
 */
export function isExecutableAvailable(command: string, cwd = process.cwd()): boolean {
  const isWindows = process.platform === 'win32'
  const directories = command.includes('/') || command.includes('\\')
    ? ['']
    : [
        // Windows resolves a bare command against the working directory too, and
        // its `PATH` entries can be quoted.
        ...isWindows ? [cwd] : [],
        ...(process.env.PATH || '')
          .split(delimiter)
          .filter(Boolean)
          .map(directory => isWindows ? directory.replace(SURROUNDING_QUOTES_RE, '$1') : directory),
      ]

  const extensions = isWindows
    ? [...command.includes('.') ? [''] : [], ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(delimiter)]
    : ['']

  for (const directory of directories) {
    for (const extension of extensions) {
      try {
        if (statSync(resolve(cwd, directory, command + extension)).isFile()) {
          return true
        }
      }
      catch {
        // not this candidate
      }
    }
  }

  return false
}

function execute(command: string, args: string[], options: InstallOptions): Promise<InstallResult> {
  const displayCommand = [command, ...args].join(' ')

  if (!isExecutableAvailable(command, options.cwd)) {
    return Promise.resolve({
      success: false,
      missingPackageManager: true,
      error: `\`${command}\` was not found. Install it (or choose a different package manager) and try again.`,
      command: displayCommand,
      output: '',
      ignoredBuilds: [],
    })
  }

  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Give the install its own process group so aborting can reach the package
    // manager corepack spawns, not just corepack itself.
    detached: process.platform !== 'win32',
  }
  const normalized = normalizeSpawnCommand(command, args, spawnOptions)

  return new Promise<InstallResult>((resolve) => {
    const child = spawn(normalized.command, [...normalized.args], normalized.options)

    const abort = () => killTree(child)
    if (options.signal?.aborted) {
      abort()
    }
    else {
      options.signal?.addEventListener('abort', abort, { once: true })
    }

    const chunks: string[] = []
    let pending = ''
    let lastActivity = Date.now()
    let notifiedStall = false

    const onData = (chunk: Buffer | string) => {
      lastActivity = Date.now()
      const text = String(chunk)
      chunks.push(text)

      if (!options.onOutput) {
        return
      }
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        options.onOutput(line)
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const stallTimer = setInterval(() => {
      if (notifiedStall || Date.now() - lastActivity < STALL_TIMEOUT) {
        return
      }
      notifiedStall = true
      options.onStatus?.(`\`${displayCommand}\` has produced no output for ${STALL_TIMEOUT / 1000}s and may be stuck`)
    }, STALL_POLL_INTERVAL)
    stallTimer.unref?.()

    let settled = false
    const finish = (result: Omit<InstallResult, 'output' | 'command' | 'ignoredBuilds'>) => {
      if (settled) {
        return
      }
      settled = true
      clearInterval(stallTimer)
      options.signal?.removeEventListener('abort', abort)
      if (pending && options.onOutput) {
        options.onOutput(pending)
      }
      const output = chunks.join('')
      resolve({
        ...result,
        command: displayCommand,
        // Only the tail is kept for display, so anything parsed out of the
        // output has to be parsed from all of it.
        output: tail(output),
        ignoredBuilds: getIgnoredBuilds(output),
      })
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({
          success: false,
          missingPackageManager: true,
          error: `\`${command}\` was not found. Install it (or choose a different package manager) and try again.`,
        })
        return
      }
      finish({ success: false, error: error.message })
    })

    child.on('close', (code, signal) => {
      if (code === 0) {
        finish({ success: true })
        return
      }
      const reason = code === null
        ? `was terminated${signal ? ` by ${signal}` : ''}`
        : `failed with exit code ${code}`
      finish({ success: false, error: `\`${displayCommand}\` ${reason}.` })
    })
  })
}

/**
 * Terminate an install, including whatever it spawned in turn, escalating to
 * `SIGKILL` for a package manager that does not stop on its own.
 */
function killTree(child: ChildProcess) {
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined && process.platform !== 'win32') {
        process.kill(-child.pid, signal)
        return
      }
      child.kill(signal)
    }
    catch {
      // the process is already gone
    }
  }

  kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      kill('SIGKILL')
    }
  }, KILL_GRACE_PERIOD).unref?.()
}

function tail(output: string): string {
  const lines = output.replace(/\s+$/, '').split('\n')
  return lines.slice(-OUTPUT_TAIL_LINES).join('\n')
}

let corepackAvailable: Promise<boolean> | undefined

async function withCorepack(command: string, args: string[]): Promise<[string, string[]]> {
  if (!COREPACK_PACKAGE_MANAGERS.has(command) || !await hasCorepack()) {
    return [command, args]
  }
  return ['corepack', [command, ...args]]
}

async function hasCorepack(): Promise<boolean> {
  if (provider === 'stackblitz') {
    return false
  }
  corepackAvailable ||= Promise.resolve(x('corepack', ['--version']))
    .then(result => result.exitCode === 0)
    .catch(() => false)
  return await corepackAvailable
}
