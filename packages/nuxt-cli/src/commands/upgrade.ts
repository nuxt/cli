import type { PackageJson } from 'pkg-types'

import type { InstallResult } from '../utils/install'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { cancel, intro, isCancel, note, outro, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { detectPackageManager } from 'nypm'
import { dirname, relative, resolve } from 'pathe'
import colors from 'picocolors'
import { findWorkspaceDir, readPackageJSON } from 'pkg-types'

import { createInstallLog, runDedupe, runInstall, takeUnreportedIgnoredBuilds } from '../utils/install'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'
import { getPackageManagerVersion } from '../utils/packageManagers'
import { relativeToProcess } from '../utils/paths'
import { getNuxtVersion } from '../utils/versions'
import { cwdArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

function checkNuxtDependencyType(pkg: PackageJson): 'dependencies' | 'devDependencies' {
  if (pkg.dependencies?.nuxt) {
    return 'dependencies'
  }
  if (pkg.devDependencies?.nuxt) {
    return 'devDependencies'
  }
  return 'dependencies'
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
    ...cwdArgs,
    ...logLevelArgs,
    ...legacyRootDirArgs,
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
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    intro(colors.cyan('Upgrading Nuxt ...'))

    // Check package manager
    const [packageManager, workspaceDir = cwd] = await Promise.all([detectPackageManager(cwd), findWorkspaceDir(cwd, { try: true })])
    if (!packageManager) {
      logger.error(
        `Unable to determine the package manager used by this project.\n\nNo lock files found in ${colors.cyan(relativeToProcess(cwd))}, and no ${colors.cyan('packageManager')} field specified in ${colors.cyan('package.json')}.`,
      )
      logger.info(`Please either add the ${colors.cyan('packageManager')} field to ${colors.cyan('package.json')} or execute the installation command for your package manager. For example, you can use ${colors.cyan('pnpm i')}, ${colors.cyan('npm i')}, ${colors.cyan('bun i')}, or ${colors.cyan('yarn i')}, and then try again.`)
      process.exit(1)
    }
    const { name: packageManagerName, lockFile: lockFileCandidates } = packageManager
    const packageManagerVersion = getPackageManagerVersion(packageManagerName)
    logger.step(`Package manager: ${colors.cyan(packageManagerName)} ${packageManagerVersion}`)

    // Check currently installed Nuxt version
    const currentVersion = (await getNuxtVersion(cwd, false)) || '[unknown]'
    logger.step(`Current Nuxt version: ${colors.cyan(currentVersion)}`)

    const pkg = await readPackageJSON(cwd).catch(() => null)

    // Check if Nuxt is a dependency or devDependency
    const nuxtDependencyType = pkg ? checkNuxtDependencyType(pkg) : 'dependencies'
    const corePackages = ['@nuxt/kit', '@nuxt/schema', '@nuxt/vite-builder', '@nuxt/webpack-builder', '@nuxt/rspack-builder']

    const packagesToUpdate = pkg ? corePackages.filter(p => pkg.dependencies?.[p] || pkg.devDependencies?.[p]) : []

    // Install latest version
    const { npmPackages, nuxtVersion } = await getRequiredNewVersion(['nuxt', ...packagesToUpdate], ctx.args.channel)

    // Force install
    const toRemove = ['node_modules']

    const lockFile = findLockFile(cwd, workspaceDir, lockFileCandidates)
    if (lockFile) {
      toRemove.push(lockFile)
    }
    else {
      logger.error(
        cwd === workspaceDir
          ? `Unable to find a ${packageManagerName} lock file in ${colors.cyan(relativeToProcess(cwd))}.`
          : `Unable to find a ${packageManagerName} lock file in ${colors.cyan(relativeToProcess(cwd))} or any directory up to ${colors.cyan(relativeToProcess(workspaceDir))}.`,
      )
    }

    const forceRemovals = toRemove
      .map(p => colors.cyan(p))
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

    const installFailed = await withInstallSpinner(
      `Installing ${versionType} Nuxt ${nuxtVersion} release`,
      'Nuxt packages installed',
      { verbose },
      hooks => runInstall({
        cwd,
        packageManager,
        dependencies: npmPackages,
        dev: nuxtDependencyType === 'devDependencies',
        workspace: packageManager.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
        ...hooks,
      }),
    )

    if (installFailed) {
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
      logger.info(`If you encounter any issues, revert the changes and try with ${colors.cyan('--no-force')}`)
    }

    // Check installed Nuxt version again
    const upgradedVersion = (await getNuxtVersion(cwd, false)) || '[unknown]'

    if (upgradedVersion === '[unknown]') {
      return
    }

    if (upgradedVersion === currentVersion) {
      outro(`You were already using the latest version of Nuxt (${colors.green(currentVersion)})`)
    }
    else {
      logger.success(
        `Successfully upgraded Nuxt from ${colors.cyan(currentVersion)} to ${colors.green(upgradedVersion)}`,
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
    logger.warn(`Build scripts were not run for ${ignoredBuilds.map(name => colors.cyan(name)).join(', ')}.`)
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
