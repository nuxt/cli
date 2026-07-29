import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveModulePath } from 'exsolve'

import { isNuxiCommand } from '../../nuxt-cli/src/commands/_utils'
import { tryResolveNuxt } from '../../nuxt-cli/src/utils/kit'
import { withNodePath } from '../../nuxt-cli/src/utils/paths'

const FLAG_RE = /^-/

const BACKSLASH_RE = /\\/g

const launcherDist = comparablePath(join(fileURLToPath(new URL('../', import.meta.url)), 'dist'))

/**
 * Oldest project CLI worth handing off to: 3.26.0 is the first release that
 * ships the forkable dev entry alongside `runMain`. (`@nuxt/cli` v2 is the
 * unrelated Nuxt 2 CLI.)
 */
const MIN_PROJECT_CLI: [major: number, minor: number] = [3, 26]

/**
 * Run the requested command with the `@nuxt/cli` installed in the user's
 * project, so it matches the version of Nuxt it is installed alongside.
 *
 * Falls back to the commands bundled with `nuxi` whenever the project CLI
 * cannot run the command itself: no project CLI, one too old to hand off to, or
 * one that does not know this command (a project pinned to an older release
 * still gets newer commands, rather than an error).
 */
export async function runMain(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  const cli = loadProjectCli(rawArgs)
  const delegate = cli && await loadDelegate(cli, commandName(rawArgs))
  if (delegate) {
    return delegate()
  }

  const { runFallbackMain } = await import('./main')
  return runFallbackMain()
}

interface ProjectCli {
  name: string
  version: string | undefined
  entry: string
  devEntry: string | undefined
}

export function loadProjectCli(rawArgs: string[]): ProjectCli | null {
  for (const dir of candidateDirs(rawArgs)) {
    // trailing separators keep `exsolve` from treating the directories as files
    const from = [tryResolveNuxt(dir), ...withNodePath(dir).map(path => join(path, '/'))].filter(Boolean) as string[]
    const entry = resolveModulePath('@nuxt/cli', { from, try: true })
    // resolving to our own build (a global or `npx` install of `nuxi`) would recurse
    if (!entry || comparablePath(entry).startsWith(`${launcherDist}/`)) {
      continue
    }
    const pkg = findPackage(entry, '@nuxt/cli')
    if (pkg?.version && !isAtLeast(pkg.version, MIN_PROJECT_CLI)) {
      continue
    }
    const devEntry = pkg && join(pkg.root, 'dist/dev/index.mjs')
    return {
      name: '@nuxt/cli',
      version: pkg?.version,
      entry,
      devEntry: devEntry && existsSync(devEntry) ? devEntry : undefined,
    }
  }
  return null
}

async function loadDelegate(cli: ProjectCli, command: string | undefined) {
  const mod = await import(pathToFileURL(cli.entry).href).catch(() => null) as { runMain?: () => Promise<void>, main?: unknown } | null
  if (typeof mod?.runMain !== 'function') {
    return null
  }

  if (command && !supportsCommand(mod.main, command)) {
    return null
  }

  // the dev server forks this entry, so it must come from the CLI running the command
  if (command === 'dev' && !cli.devEntry) {
    return null
  }
  if (globalThis.__nuxt_cli__ && cli.devEntry) {
    globalThis.__nuxt_cli__.devEntry = cli.devEntry
  }

  return mod.runMain
}

/**
 * Whether the project CLI can handle a command itself. Only known `nuxi`
 * commands are checked against its subcommands; anything else (`complete`, or a
 * locally registered `nuxt-<command>` binary) is left for it to interpret.
 */
export function supportsCommand(main: unknown, command: string): boolean {
  if (!isNuxiCommand(command)) {
    return true
  }
  const subCommands = (main as { subCommands?: unknown } | undefined)?.subCommands
  if (!subCommands || typeof subCommands !== 'object') {
    return true
  }
  return command in subCommands
}

function commandName(rawArgs: string[]) {
  return rawArgs.find(arg => !FLAG_RE.test(arg))
}

/**
 * Directories the project CLI might be installed relative to, in priority order:
 * an explicit `--cwd`, a positional root directory (`nuxi info ../my-app`), then `process.cwd()`.
 */
function candidateDirs(rawArgs: string[]) {
  const dirs: string[] = []
  const add = (dir: string | undefined) => {
    if (dir && !dirs.includes(dir)) {
      dirs.push(dir)
    }
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!
    if (arg === '--cwd') {
      add(resolveDir(rawArgs[i + 1]))
    }
    else if (arg.startsWith('--cwd=')) {
      add(resolveDir(arg.slice('--cwd='.length)))
    }
  }

  // `init` takes a project name rather than an existing root directory
  if (rawArgs[0] !== 'init') {
    for (const arg of rawArgs.slice(1)) {
      if (!FLAG_RE.test(arg)) {
        add(resolveDir(arg))
      }
    }
  }

  add(process.cwd())

  return dirs
}

function resolveDir(value: string | undefined) {
  if (!value || FLAG_RE.test(value)) {
    return
  }
  const dir = resolve(process.cwd(), value)
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

/**
 * Normalising paths from `exsolve` and `import.meta.url` so they can be compared
 */
function comparablePath(path: string) {
  let resolved = path
  try {
    resolved = realpathSync(path)
  }
  catch {}
  resolved = resolved.replace(BACKSLASH_RE, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isAtLeast(version: string, [minMajor, minMinor]: [number, number]) {
  const [major = 0, minor = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  return major > minMajor || (major === minMajor && minor >= minMinor)
}

function findPackage(entry: string, name: string) {
  let dir = dirname(entry)
  for (let i = 0; i < 5; i++) {
    const path = join(dir, 'package.json')
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: string, version?: string }
        if (pkg.name === name) {
          return { root: dir, version: pkg.version }
        }
      }
      catch {}
    }
    const next = dirname(dir)
    if (next === dir) {
      break
    }
    dir = next
  }
  return null
}
