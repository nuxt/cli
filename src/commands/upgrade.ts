import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { relative, resolve } from 'pathe'
import type { PackageJson } from 'pkg-types'
import { readPackageJSON } from 'pkg-types'
import { defineCommand } from 'citty'
import {
  getPackageManager,
  packageManagerLocks,
} from '../utils/packageManagers'
import { rmRecursive, touchFile } from '../utils/fs'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'

import { loadKit } from '../utils/kit'
import { legacyRootDirArgs, sharedArgs } from './_shared'

async function getNuxtVersion(path: string): Promise<string | null> {
  try {
    const pkg = await readPackageJSON('nuxt', { url: path })
    if (!pkg.version) {
      consola.warn('Cannot find any installed Nuxt versions in ', path)
    }
    return pkg.version || null
  }
  catch {
    return null
  }
}

async function checkNuxtDependencyType(pkg: PackageJson): Promise<'dependencies' | 'devDependencies' | null> {
  if (pkg.dependencies && pkg.dependencies['nuxt']) {
    return 'dependencies'
  }
  if (pkg.devDependencies && pkg.devDependencies['nuxt']) {
    return 'devDependencies'
  }
  return 'dependencies'
}

function hasPnpmWorkspaceFile(cwd: string): boolean {
  const pnpmWorkspaceFilePath = resolve(cwd, 'pnpm-workspace.yaml')
  return existsSync(pnpmWorkspaceFilePath)
}

const nuxtVersionTags = {
  '3.x': '3x',
  '4.x': 'latest',
}

async function getNightlyVersion(packageNames: string[]): Promise<{ npmPackages: string[], nuxtVersion: string }> {
  const result = await consola.prompt(
    'Which nightly Nuxt release channel do you want to install? (3.x or 4.x)',
    {
      type: 'select',
      options: ['3.x', '4.x'],
      default: '3.x',
    },
  ) as '3.x' | '4.x'

  const nuxtVersion = typeof result === 'string' ? result : '3.x'

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
    ...sharedArgs,
    ...legacyRootDirArgs,
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Force upgrade to recreate lockfile and node_modules',
    },
    dedupe: {
      type: 'boolean',
      description: 'Dedupe dependencies after upgrading',
    },
    channel: {
      type: 'string',
      alias: 'ch',
      default: 'stable',
      description: 'Specify a channel to install from (nightly or stable)',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    // Check package manager
    const packageManager = getPackageManager(cwd)
    if (!packageManager) {
      consola.error(
        `Unable to determine the package manager used by this project.\n\nNo lock files found in \`${cwd}\`, and no \`packageManager\` field specified in \`package.json\`.\n\nPlease either add the \`packageManager\` field to \`package.json\` or execute the installation command for your package manager. For example, you can use \`pnpm i\`, \`npm i\`, \`bun i\`, or \`yarn i\`, and then try again.`,
      )
      process.exit(1)
    }
    const packageManagerVersion = execSync(`${packageManager} --version`)
      .toString('utf8')
      .trim()
    consola.info('Package manager:', packageManager, packageManagerVersion)

    // Check currently installed Nuxt version
    const currentVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    consola.info('Current Nuxt version:', currentVersion)

    const pkg = await readPackageJSON(cwd).catch(() => null)

    // Check if Nuxt is a dependency or devDependency
    const nuxtDependencyType = pkg ? await checkNuxtDependencyType(pkg) : 'dependencies'
    const corePackages = ['@nuxt/kit', '@nuxt/schema', '@nuxt/vite-builder', '@nuxt/webpack-builder', '@nuxt/rspack-builder']

    const packagesToUpdate = pkg ? corePackages.filter(p => pkg.dependencies?.[p] || pkg.devDependencies?.[p]) : []

    // Install latest version
    const { npmPackages, nuxtVersion } = await getRequiredNewVersion(['nuxt', ...packagesToUpdate], ctx.args.channel)

    // Force install
    const pmLockFile = resolve(cwd, packageManagerLocks[packageManager])
    const forceRemovals = ['node_modules', relative(process.cwd(), pmLockFile)]
      .map(p => colors.cyan(p))
      .join(' and ')

    let method: 'force' | 'dedupe' | 'skip' | undefined = ctx.args.force ? 'force' : ctx.args.dedupe ? 'dedupe' : undefined
    method ||= await consola.prompt(
      `Would you like to dedupe your lockfile (recommended) or recreate ${forceRemovals}? This can fix problems with hoisted dependency versions and ensure you have the most up-to-date dependencies.`,
      {
        type: 'select',
        initial: 'dedupe',
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
    )

    // user bails on the question with Ctrl+C
    if (typeof method !== 'string') {
      process.exit(1)
    }

    if (method === 'force') {
      consola.info(`Recreating ${forceRemovals}. If you encounter any issues, revert the changes and try with \`--no-force\``)
      await rmRecursive([pmLockFile, resolve(cwd, 'node_modules')])
      await touchFile(pmLockFile)
    }

    const versionType = ctx.args.channel === 'nightly' ? 'nightly' : 'latest stable'
    consola.info(`Installing ${versionType} Nuxt ${nuxtVersion} release...`)

    const command = [
      packageManager,
      packageManager === 'yarn' ? 'add' : 'install',
      nuxtDependencyType === 'devDependencies' ? '-D' : '',
      packageManager === 'pnpm' && hasPnpmWorkspaceFile(cwd) ? '-w' : '',
      ...npmPackages,
    ].filter(Boolean).join(' ')

    execSync(command, { stdio: 'inherit', cwd })

    if (method === 'dedupe') {
      if (packageManager !== 'bun') {
        consola.info('Deduping dependencies...')
        execSync(`${packageManager} dedupe`, { stdio: 'inherit', cwd })
      }
      consola.info(`Deduping dependencies is not yet supported with ${packageManager}.`)
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
    consola.info('Upgraded Nuxt version:', upgradedVersion)

    if (upgradedVersion === '[unknown]') {
      return
    }

    if (upgradedVersion === currentVersion) {
      consola.success('You\'re already using the latest version of Nuxt.')
    }
    else {
      consola.success(
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
        consola.info(
          'Changelog:',
          `https://github.com/nuxt/nuxt/compare/${commitA}...${commitB}`,
        )
      }
    }
  },
})
