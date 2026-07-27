import type { PackageManagerName } from 'nypm'

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { basename } from 'pathe'
import { isWindows } from 'std-env'

import { debug } from './logger'

const BIN_EXTENSION_RE = /\.[cm]?js$/
const NEEDS_QUOTING_RE = /[\s"'$`\\]/
const SINGLE_QUOTE_RE = /'/g
const DOUBLE_QUOTE_RE = /"/g
const CREATE_BIN_RE = /^create-nuxt(?:-app)?$/

// `@latest` everywhere: package managers happily reuse a cached `create-nuxt`,
// so an unpinned invocation can keep scaffolding from a stale version.
const createCommands: Partial<Record<PackageManagerName, string>> = {
  npm: 'npm create nuxt@latest',
  pnpm: 'pnpm create nuxt@latest',
  yarn: 'yarn create nuxt@latest',
  bun: 'bun create nuxt@latest',
  deno: 'deno run -A npm:create-nuxt@latest',
}

function currentPackageManager(userAgent: string | undefined): PackageManagerName | undefined {
  const name = userAgent?.split('/')[0]
  return name && name in createCommands ? name as PackageManagerName : undefined
}

/**
 * The command a user would type to reach the current invocation, used as the
 * prefix of the non-interactive command we suggest. `create-nuxt` is reached
 * through a package manager, so it is echoed back in that form rather than as
 * the bin name, which is not on the user's `PATH`.
 */
export function getInvocationPrefix(argv: string[] = process.argv, userAgent = process.env.npm_config_user_agent): string {
  return isCreateInvocation(argv) ? getCreateCommand(userAgent) : 'nuxt init'
}

/** Whether the CLI was reached through `create-nuxt` rather than `nuxt init`. */
function isCreateInvocation(argv: string[]): boolean {
  return CREATE_BIN_RE.test(basename(argv[1] || '').replace(BIN_EXTENSION_RE, ''))
}

/** How to scaffold a project with the latest release, in the user's package manager. */
export function getCreateCommand(userAgent = process.env.npm_config_user_agent): string {
  return createCommands[currentPackageManager(userAgent) ?? 'npm']!
}

const PINNED_CREATE_RE = /\bcreate[ -]nuxt(?:-app)?@/
const PROC_PPID_RE = /^\d+ \S+ \S+ (\d+)/

/**
 * The command lines of this process' ancestors, nearest first. The invoking
 * package manager is not our direct parent in every setup, so a few generations
 * are walked. Returns an empty list when the platform gives us no way to look.
 */
function getAncestorCommands(depth = 4): string[] {
  const commands: string[] = []
  try {
    if (process.platform === 'linux') {
      let pid = process.ppid
      for (let level = 0; level < depth && pid > 1; level++) {
        commands.push(readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim())
        // `comm` may contain spaces, so ppid is read past the parenthesised name.
        pid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/\(.*\)/, 'x').match(PROC_PPID_RE)?.[1])
      }
      return commands
    }

    const listing = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 1000 })
    const parents = new Map<number, { ppid: number, command: string }>()
    for (const line of listing.split('\n')) {
      const [pid, ppid, ...command] = line.trim().split(/ +/)
      if (pid && /^\d+$/.test(pid)) {
        parents.set(Number(pid), { ppid: Number(ppid), command: command.join(' ') })
      }
    }
    for (let pid = process.ppid, level = 0; level < depth && pid > 1; level++) {
      const parent = parents.get(pid)
      if (!parent) {
        break
      }
      commands.push(parent.command)
      pid = parent.ppid
    }
  }
  catch (error) {
    debug('Failed to inspect parent processes:', error)
  }
  return commands
}

/**
 * Whether the user pinned a version or tag when invoking the scaffolder, e.g.
 * `pnpm create nuxt@latest`. Package managers do not pass the requested spec
 * down to the package they run, so it is recovered from the invoking command.
 * Defaults to `false` when nothing can be determined.
 */
export function isPinnedCreateInvocation(commands: string[] = getAncestorCommands()): boolean {
  return commands.some(command => PINNED_CREATE_RE.test(command))
}

/**
 * The line-continuation marker for the shell the user is most likely in, so a
 * wrapped command can still be pasted as a single invocation.
 */
function getContinuation(windows: boolean, env: NodeJS.ProcessEnv): string {
  // Git Bash and other MSYS environments report as Windows but run a POSIX shell.
  if (!windows || env.MSYSTEM) {
    return '\\'
  }
  // Neither marker can be detected reliably, so this is a guess: `PSModulePath`
  // is set in PowerShell, which needs a backtick, and absent in a bare cmd.exe,
  // which needs `^`. A cmd.exe launched from PowerShell inherits it and loses.
  return env.PSModulePath ? '`' : '^'
}

/**
 * Quote a value so the shell passes it through unchanged. POSIX shells still
 * expand `$` and backticks inside double quotes, so single quotes are used
 * there; cmd.exe and PowerShell have no single-quoted form in common.
 */
function quoteArgument(value: string, windows: boolean): string {
  if (!NEEDS_QUOTING_RE.test(value)) {
    return value
  }
  return windows
    ? `"${value.replace(DOUBLE_QUOTE_RE, '\\"')}"`
    : `'${value.replace(SINGLE_QUOTE_RE, `'\\''`)}'`
}

export interface HeadlessCommandOptions {
  prefix?: string
  dir: string
  template: string
  packageManager: PackageManagerName
  gitInit: boolean
  install: boolean
  force?: boolean
  modules?: string[]
  nightly?: string
  windows?: boolean
}

/**
 * The arguments that reproduce a scaffold without any prompts, as separate
 * tokens so they can be wrapped for display.
 */
export function getHeadlessCommand(options: HeadlessCommandOptions): string[] {
  const { prefix = getInvocationPrefix(), dir, template, packageManager, gitInit, install, force, modules, nightly, windows = isWindows } = options
  return [
    prefix,
    quoteArgument(dir, windows),
    `--template=${template}`,
    `--packageManager=${packageManager}`,
    gitInit ? '--gitInit' : '--no-gitInit',
    modules?.length ? `--modules=${modules.join(',')}` : '--no-modules',
    install ? '' : '--no-install',
    force ? '--force' : '',
    nightly ? `--nightly=${nightly}` : '',
  ].filter(Boolean)
}

export interface WrapOptions {
  /** Columns available for the command itself, excluding any surrounding gutter. */
  width?: number
  /** Spaces to indent continuation lines by. */
  indent?: number
  windows?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Break a command into lines that fit `width`, joined with the shell's
 * line-continuation marker so the result stays runnable when pasted. Tokens are
 * never split, so a single token longer than `width` overflows its line.
 */
export function wrapCommand(tokens: string[], options: WrapOptions = {}): string[] {
  const { width = 80, indent = 2, windows = isWindows, env = process.env } = options
  const continuation = getContinuation(windows, env)
  const lines: string[] = []
  let current = ''

  for (const token of tokens) {
    if (!current) {
      current = token
      continue
    }
    if (current.length + token.length + 1 + continuation.length + 1 > width) {
      lines.push(`${current} ${continuation}`)
      current = ' '.repeat(indent) + token
      continue
    }
    current += ` ${token}`
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

/**
 * A copy-pasteable command that scaffolds the same project again without any
 * prompts, so the invocation can be scripted or handed to an agent.
 */
export function formatHeadlessCommand(options: HeadlessCommandOptions & WrapOptions): string[] {
  return wrapCommand(getHeadlessCommand(options), options)
}
