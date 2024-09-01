import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { relative, resolve } from 'pathe'
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

async function checkNuxtDependencyType(path: string): Promise<'dependencies' | 'devDependencies' | null> {
  try {
    const pkg = await readPackageJSON(path)
    if (pkg.dependencies && pkg.dependencies['nuxt']) {
      return 'dependencies'
    }
    if (pkg.devDependencies && pkg.devDependencies['nuxt']) {
      return 'devDependencies'
    }
    return null
  }
  catch {
    return null
  }
}

function hasPnpmWorkspaceFile(cwd: string): boolean {
  const pnpmWorkspaceFilePath = resolve(cwd, 'pnpm-workspace.yaml')
  return existsSync(pnpmWorkspaceFilePath)
}

async function getNightlyVersion(): Promise<{ npmVersion: string, nuxtVersion: string }> {
  const nuxtVersion = await consola.prompt(
    'Which version of nighlty Nuxt do you want to install? (3 or 4)',
    {
      type: 'select',
      options: ['3', '4'],
      default: '3',
    },
  ) as '3' | '4'

  const versions = {
    3: '3.x',
    4: 'latest',
  }
  const npmVersion = `nuxt@npm:nuxt-nightly@${versions[nuxtVersion]}`

  return { npmVersion, nuxtVersion }
}

async function getRequiredNewVersion(channel: string): Promise<{ npmVersion: string, nuxtVersion: string }> {
  let npmVersion = 'nuxt@latest'
  let nuxtVersion = '3'

  if (channel === 'nightly') {
    const { npmVersion: nightlyNpmVersion, nuxtVersion: nightlyNuxtVersion } = await getNightlyVersion()

    npmVersion = nightlyNpmVersion
    nuxtVersion = nightlyNuxtVersion
  }

  return { npmVersion, nuxtVersion }
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

    // Check if Nuxt is a dependency or devDependency
    const nuxtDependencyType = await checkNuxtDependencyType(cwd)

    // Force install
    const pmLockFile = resolve(cwd, packageManagerLocks[packageManager])
    const forceRemovals = ['node_modules', relative(process.cwd(), pmLockFile)]
      .map(p => colors.cyan(p))
      .join(' and ')
    if (ctx.args.force === undefined) {
      ctx.args.force = await consola.prompt(
        `Would you like to recreate ${forceRemovals} to fix problems with hoisted dependency versions and ensure you have the most up-to-date dependencies?`,
        {
          type: 'confirm',
          default: true,
        },
      )
    }
    if (ctx.args.force) {
      consola.info(
        `Recreating ${forceRemovals}. If you encounter any issues, revert the changes and try with \`--no-force\``,
      )
      await rmRecursive([pmLockFile, resolve(cwd, 'node_modules')])
      await touchFile(pmLockFile)
    }

    // Install latest version
    const { npmVersion, nuxtVersion } = await getRequiredNewVersion(ctx.args.channel)

    const versionType = ctx.args.channel === 'nightly' ? 'nightly' : 'latest stable'
    consola.info(`Installing ${versionType} Nuxt ${nuxtVersion} release...`)

    const command = [
      packageManager,
      packageManager === 'yarn' ? 'add' : 'install',
      nuxtDependencyType === 'devDependencies' ? '-D' : '',
      packageManager === 'pnpm' && hasPnpmWorkspaceFile(cwd) ? '-w' : '',
      npmVersion,
    ].filter(Boolean).join(' ')

    execSync(command, { stdio: 'inherit', cwd })

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
