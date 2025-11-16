import type { PackageJson } from 'pkg-types'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { cancel, intro, isCancel, note, outro, select, spinner, tasks } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { addDependency, dedupeDependencies, detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { findWorkspaceDir, readPackageJSON } from 'pkg-types'

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
      description: 'Specify a channel to install from (default: stable)',
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

    const lockFile = normaliseLockFile(workspaceDir, lockFileCandidates)
    if (lockFile) {
      toRemove.push(lockFile)
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

    const spin = spinner()
    spin.start('Upgrading Nuxt')

    await tasks([
      {
        title: `Installing ${versionType} Nuxt ${nuxtVersion} release`,
        task: async () => {
          await addDependency(npmPackages, {
            cwd,
            packageManager,
            dev: nuxtDependencyType === 'devDependencies',
            workspace: packageManager?.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
          })
          return 'Nuxt packages installed'
        },
      },
      ...(method === 'force'
        ? [{
            title: `Recreating ${forceRemovals}`,
            task: async () => {
              await dedupeDependencies({ recreateLockfile: true })
              return 'Lockfile recreated'
            },
          }]
        : []),
      ...(method === 'dedupe'
        ? [{
            title: 'Deduping dependencies',
            task: async () => {
              await dedupeDependencies()
              return 'Dependencies deduped'
            },
          }]
        : []),
      {
        title: 'Cleaning up build directories',
        task: async () => {
          let buildDir: string = '.nuxt'
          try {
            const { loadNuxtConfig } = await loadKit(cwd)
            const nuxtOptions = await loadNuxtConfig({ cwd })
            buildDir = nuxtOptions.buildDir
          }
          catch {
            // Use default buildDir (.nuxt)
          }
          await cleanupNuxtDirs(cwd, buildDir)
          return 'Build directories cleaned'
        },
      },
    ])

    spin.stop()

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

// Find which lock file is in use since `nypm.detectPackageManager` doesn't return this
function normaliseLockFile(cwd: string, lockFiles: string | Array<string> | undefined) {
  if (typeof lockFiles === 'string') {
    lockFiles = [lockFiles]
  }

  const lockFile = lockFiles?.find(file => existsSync(resolve(cwd, file)))

  if (lockFile === undefined) {
    logger.error(`Unable to find any lock files in ${colors.cyan(relativeToProcess(cwd))}.`)
    return undefined
  }

  return lockFile
}
