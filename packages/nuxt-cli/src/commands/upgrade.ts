import type { PackageJson } from 'pkg-types'

import type { UpdateCatalogEntriesResult } from '../utils/catalog'
import type { InstallResult } from '../utils/install'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { styleText } from 'node:util'
import { cancel, intro, isCancel, note, outro, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { detectPackageManager } from 'nypm'
import { dirname, relative, resolve } from 'pathe'
import { findWorkspaceDir, readPackageJSON } from 'pkg-types'

import { resolveCatalogEntry, updateCatalogEntries } from '../utils/catalog'
import { createInstallLog, runDedupe, runInstall, takeUnreportedIgnoredBuilds } from '../utils/install'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'
import { getPackageManagerVersion } from '../utils/packageManagers'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { getNuxtVersion, resolveRegistryVersion } from '../utils/versions'
import { logLevelArgs, rootDirArgs } from './_shared'

function checkNuxtDependencyType(pkg: PackageJson): 'dependencies' | 'devDependencies' {
  if (pkg.dependencies?.nuxt) {
    return 'dependencies'
  }
  if (pkg.devDependencies?.nuxt) {
    return 'devDependencies'
  }
  return 'dependencies'
}

const ALIAS_SPEC_RE = /^npm:(.+)@([^@]+)$/

export interface InstallSpec {
  /** Name the dependency is declared under. */
  name: string
  /** Package the version is resolved from, which differs from `name` for an aliased install. */
  target: string
  /** Dist-tag or semver range to resolve. */
  range: string
  /** Whether `target` is reached through an `npm:` alias. */
  aliased: boolean
}

/**
 * Split an install argument such as `nuxt@latest` or
 * `nuxt@npm:nuxt-nightly@latest` into the parts needed to resolve a concrete
 * version for it.
 */
export function parseInstallSpec(spec: string): InstallSpec {
  const separator = spec.lastIndexOf('@')
  if (separator < 1) {
    return { name: spec, target: spec, range: 'latest', aliased: false }
  }

  const name = spec.slice(0, separator)
  const rest = spec.slice(separator + 1)

  const alias = spec.slice(spec.indexOf('@', 1) + 1).match(ALIAS_SPEC_RE)
  if (alias) {
    return { name: spec.slice(0, spec.indexOf('@', 1)), target: alias[1]!, range: alias[2]!, aliased: true }
  }

  return { name, target: name, range: rest, aliased: false }
}

const CATALOG_RANGE_RE = /^(?:npm:.+@)?([~^]?)\d+\.\d+\.\d+(?:[-+].+)?$/

/**
 * The range operator to keep when rewriting `specifier`, so an entry pinned to an
 * exact version stays pinned. Anything that is not a plain version (a range such
 * as `>=4.0.0`, or no entry at all) gets a caret, as `pnpm add` would write.
 */
export function resolveRangePrefix(specifier: string | undefined): string {
  return specifier?.match(CATALOG_RANGE_RE)?.[1] ?? '^'
}

/**
 * The specifier a catalog entry should hold for `spec`. pnpm resolves dist-tags
 * and ranges itself when it writes to `package.json`, but a catalog entry we
 * write ourselves has to name a concrete version. `current` is the specifier the
 * entry holds today, whose range operator is preserved.
 */
export async function resolveCatalogSpecifier(spec: InstallSpec, current?: string): Promise<string | undefined> {
  const version = await resolveRegistryVersion(spec.target, spec.range)
  if (!version) {
    return undefined
  }
  const range = `${resolveRangePrefix(current)}${version}`
  return spec.aliased ? `npm:${spec.target}@${range}` : range
}

const nuxtVersionTags = {
  '3.x': '3x',
  '4.x': 'latest',
}

type NuxtVersionTag = keyof typeof nuxtVersionTags

function getNightlyDependency(dep: string, nuxtVersion: NuxtVersionTag) {
  return `${dep}@npm:${dep}-nightly@${nuxtVersionTags[nuxtVersion]}`
}

async function getNightlyVersion(packageNames: string[]): Promise<{ npmPackages: string[], nuxtVersion: NuxtVersionTag }> {
  const nuxtVersion = await select({
    message: 'Which nightly Nuxt release channel do you want to install?',
    options: [
      { value: '3.x' as const, label: '3.x' },
      { value: '4.x' as const, label: '4.x' },
    ],
    initialValue: '4.x' as const,
  })

  if (isCancel(nuxtVersion)) {
    cancel('Operation cancelled.')
    process.exit(1)
  }

  const npmPackages = packageNames.map(p => getNightlyDependency(p, nuxtVersion))

  return { npmPackages, nuxtVersion }
}

async function getRequiredNewVersion(packageNames: string[], channel: string): Promise<{ npmPackages: string[], nuxtVersion: NuxtVersionTag }> {
  switch (channel) {
    case 'nightly':
      return getNightlyVersion(packageNames)
    case 'v3':
      return { npmPackages: packageNames.map(p => `${p}@3`), nuxtVersion: '3.x' }
    case 'v3-nightly':
      return { npmPackages: packageNames.map(p => getNightlyDependency(p, '3.x')), nuxtVersion: '3.x' }
    case 'v4':
      return { npmPackages: packageNames.map(p => `${p}@4`), nuxtVersion: '4.x' }
    case 'v4-nightly':
      return { npmPackages: packageNames.map(p => getNightlyDependency(p, '4.x')), nuxtVersion: '4.x' }
    case 'stable':
    default:
      return { npmPackages: packageNames.map(p => `${p}@latest`), nuxtVersion: '4.x' }
  }
}

export default defineCommand({
  meta: {
    name: 'upgrade',
    description: 'Upgrade Nuxt',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    dedupe: {
      type: 'boolean',
      description: 'Dedupe dependencies after upgrading',
    },
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Force upgrade to recreate lockfile and node_modules',
    },
    channel: {
      type: 'string',
      alias: 'ch',
      default: 'stable',
      description: 'Specify a channel to install from',
      valueHint: 'stable|nightly|v3|v4|v4-nightly|v3-nightly',
    },
  },
  async run(ctx) {
    const cwd = resolveRootDir(ctx.args)

    intro(styleText('cyan', 'Upgrading Nuxt ...'))

    // Check package manager
    const [packageManager, workspaceDir = cwd] = await Promise.all([detectPackageManager(cwd), findWorkspaceDir(cwd, { try: true })])
    if (!packageManager) {
      logger.error(
        `Unable to determine the package manager used by this project.\n\nNo lock files found in ${styleText('cyan', relativeToProcess(cwd))}, and no ${styleText('cyan', 'packageManager')} field specified in ${styleText('cyan', 'package.json')}.`,
      )
      logger.info(`Please either add the ${styleText('cyan', 'packageManager')} field to ${styleText('cyan', 'package.json')} or execute the installation command for your package manager. For example, you can use ${styleText('cyan', 'pnpm i')}, ${styleText('cyan', 'npm i')}, ${styleText('cyan', 'bun i')}, or ${styleText('cyan', 'yarn i')}, and then try again.`)
      process.exit(1)
    }
    const { name: packageManagerName, lockFile: lockFileCandidates } = packageManager
    const packageManagerVersion = getPackageManagerVersion(packageManagerName)
    logger.step(`Package manager: ${styleText('cyan', packageManagerName)} ${packageManagerVersion}`)

    // Check currently installed Nuxt version
    const currentVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    logger.step(`Current Nuxt version: ${styleText('cyan', currentVersion)}`)

    const pkg = await readPackageJSON(cwd).catch(() => null)

    // Check if Nuxt is a dependency or devDependency
    const nuxtDependencyType = pkg ? checkNuxtDependencyType(pkg) : 'dependencies'
    const corePackages = ['@nuxt/kit', '@nuxt/schema', '@nuxt/vite-builder', '@nuxt/webpack-builder', '@nuxt/rspack-builder']

    const packagesToUpdate = pkg ? corePackages.filter(p => pkg.dependencies?.[p] || pkg.devDependencies?.[p]) : []

    // Install latest version
    const packageNames = ['nuxt', ...packagesToUpdate]
    const { npmPackages, nuxtVersion } = await getRequiredNewVersion(packageNames, ctx.args.channel)

    // A `catalog:` dependency has to be upgraded in `pnpm-workspace.yaml`: asking
    // pnpm to add a pinned version instead replaces the reference in
    // `package.json`, silently taking the dependency out of the catalog.
    const catalogUpdates: Array<{ catalog: string, current?: string, spec: InstallSpec }> = []
    const directPackages: string[] = []
    for (const [index, name] of packageNames.entries()) {
      const entry = packageManagerName === 'pnpm' ? resolveCatalogEntry(cwd, pkg, name) : undefined
      if (entry) {
        catalogUpdates.push({ catalog: entry.catalog, current: entry.specifier, spec: parseInstallSpec(npmPackages[index]!) })
      }
      else {
        directPackages.push(npmPackages[index]!)
      }
    }

    // Force install
    const toRemove = ['node_modules']

    const lockFile = findLockFile(cwd, workspaceDir, lockFileCandidates)
    if (lockFile) {
      toRemove.push(lockFile)
    }
    else {
      logger.error(
        cwd === workspaceDir
          ? `Unable to find a ${packageManagerName} lock file in ${styleText('cyan', relativeToProcess(cwd))}.`
          : `Unable to find a ${packageManagerName} lock file in ${styleText('cyan', relativeToProcess(cwd))} or any directory up to ${styleText('cyan', relativeToProcess(workspaceDir))}.`,
      )
    }

    const forceRemovals = toRemove
      .map(p => styleText('cyan', p))
      .join(' and ')

    let method: 'force' | 'dedupe' | 'skip' | undefined = ctx.args.force ? 'force' : ctx.args.dedupe ? 'dedupe' : undefined

    if (!method) {
      const result = await select({
        message: `Would you like to dedupe your lockfile, or recreate ${forceRemovals}? This can fix problems with hoisted dependency versions and ensure you have the most up-to-date dependencies.`,
        options: [
          {
            label: 'dedupe lockfile',
            value: 'dedupe' as const,
            hint: 'recommended',
          },
          {
            label: `recreate ${forceRemovals}`,
            value: 'force' as const,
          },
          {
            label: 'skip',
            value: 'skip' as const,
          },
        ],
        initialValue: 'dedupe' as const,
      })

      if (isCancel(result)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      method = result
    }

    const versionType = ctx.args.channel === 'nightly' ? 'nightly' : `latest ${ctx.args.channel}`

    const verbose = ctx.args.logLevel === 'verbose' || Boolean(process.env.DEBUG)

    let catalogResult: UpdateCatalogEntriesResult | 'skipped' = 'skipped'

    if (catalogUpdates.length > 0) {
      const catalogSpinner = spinner()
      catalogSpinner.start('Updating catalog entries')

      const resolved: Array<{ catalog: string, pkg: string, specifier: string }> = []
      const unresolved: string[] = []

      for (const { catalog, current, spec } of catalogUpdates) {
        const specifier = await resolveCatalogSpecifier(spec, current)
        if (!specifier) {
          unresolved.push(spec.name)
          continue
        }
        resolved.push({ catalog, pkg: spec.name, specifier })
      }

      if (resolved.length > 0) {
        catalogResult = updateCatalogEntries(cwd, resolved)
      }

      catalogSpinner.stop(
        catalogResult === 'updated'
          ? `Catalog entries updated: ${resolved.map(({ pkg, specifier }) => `${pkg}@${specifier}`).join(', ')}`
          : 'No catalog entries updated',
      )

      if (unresolved.length > 0) {
        logger.warn(`Unable to resolve a ${versionType} version for ${unresolved.map(name => styleText('cyan', name)).join(', ')} from the npm registry. Their catalog entries were left unchanged.`)
        logger.info(`Run with ${styleText('cyan', 'DEBUG=nuxi')} to see why the lookup failed.`)
      }

      if (catalogResult === 'failed') {
        logger.warn(`Unable to update the catalog entries for ${resolved.map(({ pkg }) => styleText('cyan', pkg)).join(', ')}. Check ${styleText('cyan', 'pnpm-workspace.yaml')} is readable and valid.`)
      }

      // Without a catalog entry pointing at the new version there is nothing for
      // the install to upgrade, and reporting success would be a lie.
      const nuxtUpgradeFailed = catalogResult === 'failed'
        ? resolved.some(({ pkg }) => pkg === 'nuxt')
        : unresolved.includes('nuxt')
      if (nuxtUpgradeFailed) {
        logger.error(`Unable to upgrade ${styleText('cyan', 'nuxt')} in ${styleText('cyan', 'pnpm-workspace.yaml')}.`)
        outro('Upgrade cancelled.')
        process.exit(1)
      }
    }

    const installFailed = await withInstallSpinner(
      `Installing ${versionType} Nuxt ${nuxtVersion} release`,
      'Nuxt packages installed',
      { verbose },
      hooks => runInstall({
        cwd,
        packageManager,
        dependencies: directPackages,
        dev: nuxtDependencyType === 'devDependencies',
        workspace: packageManager.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
        ...hooks,
      }),
    )

    if (installFailed) {
      if (catalogResult === 'updated') {
        logger.info(`Your ${styleText('cyan', 'pnpm-workspace.yaml')} catalog entries were already updated, so review them before retrying.`)
      }
      process.exit(1)
    }

    if (method === 'force' || method === 'dedupe') {
      const recreateLockfile = method === 'force'
      const failed = await withInstallSpinner(
        recreateLockfile ? `Recreating ${forceRemovals}` : 'Deduping dependencies',
        recreateLockfile ? 'Lockfile recreated' : 'Dependencies deduped',
        { verbose },
        hooks => runDedupe({ cwd, packageManager, recreateLockfile, ...hooks }),
      )

      if (failed) {
        process.exit(1)
      }
    }

    const cleanupSpinner = spinner()
    cleanupSpinner.start('Cleaning up build directories')
    let buildDir: string = '.nuxt'
    try {
      const { loadNuxtConfig } = await loadKit(cwd)
      const nuxtOptions = await loadNuxtConfig({ cwd })
      buildDir = nuxtOptions.buildDir
    }
    catch {
      // Use default buildDir (.nuxt)
    }
    await cleanupNuxtDirs(cwd, buildDir, { silent: true })
    cleanupSpinner.stop('Build directories cleaned')

    if (method === 'force') {
      logger.info(`If you encounter any issues, revert the changes and try with ${styleText('cyan', '--no-force')}`)
    }

    // Check installed Nuxt version again
    const upgradedVersion = (await getNuxtVersion(cwd)) || '[unknown]'

    if (upgradedVersion === '[unknown]') {
      return
    }

    if (upgradedVersion === currentVersion) {
      outro(`You were already using the latest version of Nuxt (${styleText('green', currentVersion)})`)
    }
    else {
      logger.success(
        `Successfully upgraded Nuxt from ${styleText('cyan', currentVersion)} to ${styleText('green', upgradedVersion)}`,
      )
      if (currentVersion === '[unknown]') {
        return
      }
      const commitA = nuxtVersionToGitIdentifier(currentVersion)
      const commitB = nuxtVersionToGitIdentifier(upgradedVersion)
      if (commitA && commitB) {
        note(
          `https://github.com/nuxt/nuxt/compare/${commitA}...${commitB}`,
          'Changelog',
        )
      }
      outro('✨ Upgrade complete!')
    }
  },
})

interface InstallHooks {
  onOutput: (line: string) => void
  onStatus: (message: string) => void
  signal: AbortSignal
}

/**
 * Run a package manager step behind a spinner, surfacing its output only when it
 * fails (or when running verbosely). Returns whether the step failed.
 */
async function withInstallSpinner(
  title: string,
  success: string,
  options: { verbose: boolean },
  run: (hooks: InstallHooks) => Promise<InstallResult>,
): Promise<boolean> {
  const controller = new AbortController()
  const installLog = createInstallLog({ verbose: options.verbose })
  const spin = spinner({
    indicator: 'timer',
    onCancel: () => controller.abort(),
  })

  spin.start(title)
  const result = await run({
    onOutput: installLog.onOutput,
    onStatus: message => spin.message(message),
    signal: controller.signal,
  })

  if (result.success) {
    spin.stop(success)
  }
  else {
    spin.error(result.error ?? `${title} failed`)
  }

  installLog.finish(result)

  const ignoredBuilds = takeUnreportedIgnoredBuilds(result.ignoredBuilds)
  if (ignoredBuilds.length > 0) {
    logger.warn(`Build scripts were not run for ${ignoredBuilds.map(name => styleText('cyan', name)).join(', ')}.`)
  }

  return !result.success
}

// Find which lock file is in use since `nypm.detectPackageManager` doesn't return this
export function findLockFile(cwd: string, workspaceDir: string, lockFiles: string | Array<string> | undefined) {
  const candidates = typeof lockFiles === 'string' ? [lockFiles] : lockFiles

  if (!candidates?.length) {
    return undefined
  }

  for (let dir = cwd; ; dir = dirname(dir)) {
    for (const file of candidates) {
      if (existsSync(resolve(dir, file))) {
        return relative(cwd, resolve(dir, file))
      }
    }
    if (dir === workspaceDir || dir === dirname(dir)) {
      return undefined
    }
  }
}
