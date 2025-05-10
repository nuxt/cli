import type { PackageJson } from 'pkg-types'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { addDependency, dedupeDependencies, detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'
import { getPackageManagerVersion } from '../utils/packageManagers'
import { cwdArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

async function getNuxtVersion(path: string): Promise<string | null> {
  try {
    const pkg = await readPackageJSON('nuxt', { url: path })
    if (!pkg.version) {
      logger.warn('Cannot find any installed Nuxt versions in ', path)
    }
    return pkg.version || null
  }
  catch {
    return null
  }
}

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

async function getNightlyVersion(packageNames: string[]): Promise<{ npmPackages: string[], nuxtVersion: string }> {
  const nuxtVersion = await logger.prompt(
    'Which nightly Nuxt release channel do you want to install? (3.x or 4.x)',
    {
      type: 'select',
      options: ['3.x', '4.x'] as const,
      default: '3.x',
      cancel: 'reject',
    },
  ).catch(() => process.exit(1))

  const npmPackages = packageNames.map(p => `${p}@npm:${p}-nightly@${nuxtVersionTags[nuxtVersion]}`)

  return { npmPackages, nuxtVersion }
}

async function getRequiredNewVersion(packageNames: string[], channel: string): Promise<{ npmPackages: string[], nuxtVersion: string }> {
  if (channel === 'nightly') {
    return getNightlyVersion(packageNames)
  }

  return { npmPackages: packageNames.map(p => `${p}@latest`), nuxtVersion: '3' }
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
      valueHint: 'stable|nightly',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    // Check package manager
    const packageManager = await detectPackageManager(cwd)
    if (!packageManager) {
      logger.error(
        `Unable to determine the package manager used by this project.\n\nNo lock files found in \`${cwd}\`, and no \`packageManager\` field specified in \`package.json\`.\n\nPlease either add the \`packageManager\` field to \`package.json\` or execute the installation command for your package manager. For example, you can use \`pnpm i\`, \`npm i\`, \`bun i\`, or \`yarn i\`, and then try again.`,
      )
      process.exit(1)
    }
    const { name: packageManagerName, lockFile: lockFileCandidates } = packageManager
    const packageManagerVersion = getPackageManagerVersion(packageManagerName)
    logger.info('Package manager:', packageManagerName, packageManagerVersion)

    // Check currently installed Nuxt version
    const currentVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    logger.info('Current Nuxt version:', currentVersion)

    const pkg = await readPackageJSON(cwd).catch(() => null)

    // Check if Nuxt is a dependency or devDependency
    const nuxtDependencyType = pkg ? checkNuxtDependencyType(pkg) : 'dependencies'
    const corePackages = ['@nuxt/kit', '@nuxt/schema', '@nuxt/vite-builder', '@nuxt/webpack-builder', '@nuxt/rspack-builder']

    const packagesToUpdate = pkg ? corePackages.filter(p => pkg.dependencies?.[p] || pkg.devDependencies?.[p]) : []

    // Install latest version
    const { npmPackages, nuxtVersion } = await getRequiredNewVersion(['nuxt', ...packagesToUpdate], ctx.args.channel)

    // Force install
    const toRemove = ['node_modules']

    const lockFile = normaliseLockFile(cwd, lockFileCandidates)
    if (lockFile) {
      toRemove.push(lockFile)
    }

    const forceRemovals = toRemove
      .map(p => colors.cyan(p))
      .join(' and ')

    let method: 'force' | 'dedupe' | 'skip' | undefined = ctx.args.force ? 'force' : ctx.args.dedupe ? 'dedupe' : undefined

    method ||= await logger.prompt(
      `Would you like to dedupe your lockfile (recommended) or recreate ${forceRemovals}? This can fix problems with hoisted dependency versions and ensure you have the most up-to-date dependencies.`,
      {
        type: 'select',
        initial: 'dedupe',
        cancel: 'reject',
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
      },
    ).catch(() => process.exit(1))

    if (method === 'force') {
      logger.info(
        `Recreating ${forceRemovals}. If you encounter any issues, revert the changes and try with \`--no-force\``,
      )
      await dedupeDependencies({ recreateLockfile: true })
    }

    const versionType = ctx.args.channel === 'nightly' ? 'nightly' : 'latest stable'
    logger.info(`Installing ${versionType} Nuxt ${nuxtVersion} release...`)

    await addDependency(npmPackages, {
      cwd,
      packageManager,
      dev: nuxtDependencyType === 'devDependencies',
    })

    if (method === 'dedupe') {
      logger.info('Try deduping dependencies...')
      await dedupeDependencies()
    }

    // Clean up after upgrade
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

    // Check installed Nuxt version again
    const upgradedVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    logger.info('Upgraded Nuxt version:', upgradedVersion)

    if (upgradedVersion === '[unknown]') {
      return
    }

    if (upgradedVersion === currentVersion) {
      logger.success('You\'re already using the latest version of Nuxt.')
    }
    else {
      logger.success(
        'Successfully upgraded Nuxt from',
        currentVersion,
        'to',
        upgradedVersion,
      )
      if (currentVersion === '[unknown]') {
        return
      }
      const commitA = nuxtVersionToGitIdentifier(currentVersion)
      const commitB = nuxtVersionToGitIdentifier(upgradedVersion)
      if (commitA && commitB) {
        logger.info(
          'Changelog:',
          `https://github.com/nuxt/nuxt/compare/${commitA}...${commitB}`,
        )
      }
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
    logger.error(`Unable to find any lock files in ${cwd}`)
    return undefined
  }

  return lockFile
}
