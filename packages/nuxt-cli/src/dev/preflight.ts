import type { PackageManager } from 'nypm'

import { accessSync, constants, existsSync, readdirSync, readFileSync } from 'node:fs'
import { styleText } from 'node:util'

import { confirm, isCancel, spinner } from '@clack/prompts'
import { dirname, join } from 'pathe'

import { restoreRawMode, withDirectStdout } from '../utils/console'
import { ActionableError } from '../utils/errors'
import { tryResolveNuxt } from '../utils/kit'
import { debug, logger } from '../utils/logger'
import { CONFIG_EXTENSIONS } from '../utils/nuxt-config'
import { relativeTo } from '../utils/paths'
import { withStartupClockPaused } from '../utils/startup-clock'
import { isInteractive } from '../utils/stdout'

const NUXT_PACKAGES = ['nuxt', 'nuxt-nightly']

/**
 * Extensions `c12` accepts for a config it parses rather than imports. Reporting
 * a project as missing is worse than looking in a few more places, so the whole
 * set is checked here even though only the importable ones can be loaded.
 */
const DATA_CONFIG_EXTENSIONS = ['.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml']

const ALL_CONFIG_EXTENSIONS = [...CONFIG_EXTENSIONS, ...DATA_CONFIG_EXTENSIONS]

const CONFIG_FILENAMES = new Set(ALL_CONFIG_EXTENSIONS.map(extension => `nuxt.config${extension}`))

/** The same configs, under both names `c12` accepts inside `.config/`. */
const CONFIG_DIR_FILENAMES = new Set([...CONFIG_FILENAMES, ...ALL_CONFIG_EXTENSIONS.map(extension => `nuxt${extension}`)])

function containsAny(dir: string, filenames: Set<string>): boolean {
  try {
    return readdirSync(dir).some(entry => filenames.has(entry))
  }
  catch {
    return false
  }
}

/**
 * Whether `dir` holds a Nuxt config in any of the places `c12` looks: alongside
 * `package.json`, or in `.config/` as `nuxt.<ext>` or `nuxt.config.<ext>`.
 */
function isNuxtConfigPresent(dir: string): boolean {
  return containsAny(dir, CONFIG_FILENAMES) || containsAny(join(dir, '.config'), CONFIG_DIR_FILENAMES)
}

function readPackageJson(dir: string): Record<string, any> | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
  }
  catch {
    return undefined
  }
}

function declaresNuxt(packageJson: Record<string, any> | undefined): boolean {
  if (!packageJson) {
    return false
  }
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
  return NUXT_PACKAGES.some(name => name in dependencies)
}

export interface ProjectLocation {
  /** `true` when `dir` itself looks like a Nuxt project. */
  isProject: boolean
  /** Nearest ancestor that looks like a Nuxt project, when `dir` does not. */
  ancestor?: string
}

/**
 * Decide whether `dir` is a Nuxt project, and if not, whether one of its
 * ancestors is: running `nuxt dev` one directory too deep otherwise silently
 * boots an unrelated, empty app rooted at the subdirectory.
 *
 * An ancestor has to hold a config to count. A monorepo root commonly depends on
 * `nuxt` for tooling without being an app, and offering to run it would be worse
 * advice than none.
 */
export function locateProject(dir: string): ProjectLocation {
  if (isNuxtConfigPresent(dir) || declaresNuxt(readPackageJson(dir))) {
    return { isProject: true }
  }

  let current = dir
  let parent = dirname(current)
  while (parent !== current) {
    if (isNuxtConfigPresent(parent)) {
      return { isProject: false, ancestor: parent }
    }
    current = parent
    parent = dirname(parent)
  }

  return { isProject: false }
}

export interface PreflightOptions {
  cwd: string
  /** Whether questions may be asked. Defaults to {@link isInteractive}. */
  interactive?: boolean
}

/**
 * Check the things that stop `nuxt dev` from starting, before it starts.
 *
 * Problems that can be resolved without guessing are resolved (installing
 * dependencies); the rest are reported as an error whose message contains the
 * command to run. Everything interactive degrades to that error when there is
 * no TTY.
 *
 * Returns the directory to start in, which is the one given unless the user
 * asked to run in a project found above it.
 *
 * @throws {ActionableError} when the dev server cannot usefully be started.
 */
async function runDevPreflight(options: PreflightOptions): Promise<string> {
  const interactive = options.interactive ?? isInteractive()

  const cwd = await resolveProjectDirectory(options.cwd, interactive)
  checkWritableBuildDir(cwd)
  await checkDependencies(cwd, interactive)

  return cwd
}

/**
 * The project directory to start in. Running one directory too deep is a typo
 * rather than an intent, so the project above is offered instead of refused.
 */
async function resolveProjectDirectory(cwd: string, interactive: boolean): Promise<string> {
  const location = locateProject(cwd)
  if (location.isProject) {
    return cwd
  }

  if (location.ancestor) {
    const relative = relativeTo(cwd, location.ancestor, { link: false })

    if (interactive) {
      logger.warn(`${styleText('cyan', cwd)} is not a Nuxt project, but ${styleText('cyan', location.ancestor)} is.`)
      const answer = await withStartupClockPaused(() => confirm({ message: `Run there instead?`, initialValue: true }))
      restoreRawMode()

      if (!isCancel(answer) && answer) {
        return location.ancestor
      }
    }

    throw new ActionableError([
      `${styleText('red', 'No Nuxt project in')} ${styleText('cyan', cwd)}${styleText('red', '.')}`,
      '',
      `A Nuxt project was found in ${styleText('cyan', location.ancestor)}. Run it from there:`,
      `  ${styleText('cyan', `cd ${relative} && nuxt dev`)}`,
      `or point the CLI at it: ${styleText('cyan', `nuxt dev --cwd ${relative}`)}`,
    ].join('\n'))
  }

  throw new ActionableError([
    `${styleText('red', 'No Nuxt project in')} ${styleText('cyan', cwd)}${styleText('red', '.')}`,
    '',
    `There is no ${styleText('cyan', 'nuxt.config')} here and no ${styleText('cyan', 'nuxt')} dependency in ${styleText('cyan', 'package.json')}.`,
    `Create one with ${styleText('cyan', 'nuxt init')}, or run ${styleText('cyan', 'nuxt dev')} from an existing project.`,
  ].join('\n'))
}

/**
 * A read-only `.nuxt` otherwise surfaces as an unhandled `EACCES` rejection
 * from whichever write happens to get there first, long after the banner.
 *
 * Only the default build directory is checked; a configured one is not known
 * until the config has been read. Write access is not enough on its own: a
 * directory also has to be searchable for anything inside it to be opened.
 * Neither bit reflects Windows ACLs or the privileges of a root user, so on
 * those the check passes and the write still fails, as it did before.
 */
function checkWritableBuildDir(cwd: string): void {
  const buildDir = join(cwd, '.nuxt')
  const target = existsSync(buildDir) ? buildDir : cwd
  try {
    accessSync(target, constants.W_OK | constants.X_OK)
  }
  catch {
    throw new ActionableError([
      `${styleText('red', 'Nuxt cannot write to')} ${styleText('cyan', target)}${styleText('red', '.')}`,
      '',
      `Grant write access with ${styleText('cyan', `chmod u+wx ${relativeTo(cwd, target, { link: false })}`)}, or remove the directory and try again.`,
    ].join('\n'))
  }
}

async function checkDependencies(cwd: string, interactive: boolean): Promise<void> {
  if (tryResolveNuxt(cwd)) {
    return
  }

  // Reachable with a `nuxt.config` and no usable manifest, where an install has
  // nothing to install from.
  const packageJson = readPackageJson(cwd)
  if (!packageJson) {
    throw new ActionableError([
      `${styleText('red', 'There is no readable')} ${styleText('cyan', 'package.json')} ${styleText('red', 'in')} ${styleText('cyan', cwd)}${styleText('red', '.')}`,
      '',
      `Create or repair it, then add ${styleText('cyan', 'nuxt')} as a dependency.`,
    ].join('\n'))
  }

  if (!declaresNuxt(packageJson)) {
    const { name } = await detectInstaller(cwd)
    throw new ActionableError([
      `${styleText('red', '`nuxt` is not a dependency of this project.')}`,
      '',
      `Add it with ${styleText('cyan', `${name} add nuxt`)}, or run ${styleText('cyan', 'nuxt init')} to start a new project.`,
    ].join('\n'))
  }

  await withStartupClockPaused(() => offerInstall(cwd, interactive))
}

/**
 * The package manager to tell the user to run. `../utils/install` is loaded on
 * demand: it and `nypm` are only needed once something is already wrong, so they
 * stay out of the modules a successful `nuxt dev` loads.
 */
async function detectInstaller(cwd: string): Promise<PackageManager> {
  const { detectProjectPackageManager, resolvePackageManagerDescriptor } = await import('../utils/install')

  return await detectProjectPackageManager(cwd) ?? resolvePackageManagerDescriptor('npm')
}

async function offerInstall(cwd: string, interactive: boolean): Promise<void> {
  const packageManager = await detectInstaller(cwd)
  const command = `${packageManager.name} install`
  const reason = 'Dependencies are not installed.'

  if (!interactive) {
    throw new ActionableError(`${reason}\nRun ${styleText('cyan', command)} first.`)
  }

  logger.warn(reason)
  const answer = await confirm({ message: `Run ${styleText('cyan', command)} now?`, initialValue: true })
  restoreRawMode()

  if (isCancel(answer) || !answer) {
    throw new ActionableError(`${styleText('red', 'Cannot start the dev server without dependencies.')}\nRun ${styleText('cyan', command)} and try again.`)
  }

  const { createInstallLog, runInstall } = await import('../utils/install')

  const controller = new AbortController()
  const installLog = createInstallLog()
  const installSpinner = spinner({ indicator: 'timer', onCancel: () => controller.abort() })
  installSpinner.start(`Installing with ${styleText('cyan', packageManager.name)}`)

  const result = await runInstall({
    cwd,
    packageManager,
    onOutput: installLog.onOutput,
    onStatus: message => installSpinner.message(message),
    signal: controller.signal,
  })

  if (!result.success) {
    installSpinner.error(result.error ?? 'Install failed')
    installLog.finish(result)
    throw new ActionableError(`${styleText('red', 'Dependencies could not be installed.')}\nFix the error above, then run ${styleText('cyan', command)} and try again.`)
  }

  installSpinner.stop('Dependencies installed')
  installLog.finish(result)
}

/**
 * Run preflight, letting its advice reach the user and swallowing anything else,
 * and return the directory the dev server should start in.
 *
 * A bug in a check must never be the reason `nuxt dev` refuses to start, so only
 * an {@link ActionableError} propagates.
 */
export async function preflight(options: PreflightOptions): Promise<string> {
  try {
    return await withDirectStdout(() => runDevPreflight(options))
  }
  catch (error) {
    if (error instanceof ActionableError) {
      throw error
    }
    debug('Preflight check failed:', error)
    return options.cwd
  }
}
