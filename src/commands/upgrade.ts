import { execSync } from 'node:child_process'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { relative, resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import {
  getPackageManager,
  packageManagerLocks,
} from '../utils/packageManagers'
import { rmRecursive, touchFile } from '../utils/fs'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'
import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

async function getNuxtVersion(path: string): Promise<string | null> {
  try {
    const pkg = await readPackageJSON('nuxt', { url: path })
    if (!pkg.version) {
      consola.warn('Cannot find any installed nuxt versions in ', path)
    }
    return pkg.version || null
  } catch {
    return null
  }
}

export default defineCommand({
  meta: {
    name: 'upgrade',
    description: 'Upgrade nuxt',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Force upgrade to recreate lockfile and node_modules',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    // Check package manager
    const packageManager = getPackageManager(cwd)
    if (!packageManager) {
      console.error(`Unable to determine which package manager this project uses (no known lock files in \`${cwd}\` or `packageManager` field in \`package.json\`), please run the install command for your package manager, ex: "pnpm i" or "npm i" first, and try again.`)
      process.exit(1)
    }
    const packageManagerVersion = execSync(`${packageManager} --version`)
      .toString('utf8')
      .trim()
    consola.info('Package Manager:', packageManager, packageManagerVersion)

    // Check currently installed nuxt version
    const currentVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    consola.info('Current nuxt version:', currentVersion)

    // Force install
    const pmLockFile = resolve(cwd, packageManagerLocks[packageManager])
    const forceRemovals = ['node_modules', relative(process.cwd(), pmLockFile)]
      .map((p) => colors.cyan(p))
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
    consola.info('Installing latest Nuxt 3 release...')
    execSync(
      `${packageManager} ${
        packageManager === 'yarn' ? 'add' : 'install'
      } -D nuxt`,
      { stdio: 'inherit', cwd },
    )

    // Cleanup after upgrade
    await cleanupNuxtDirs(cwd)

    // Check installed nuxt version again
    const upgradedVersion = (await getNuxtVersion(cwd)) || '[unknown]'
    consola.info('Upgraded nuxt version:', upgradedVersion)

    if (upgradedVersion === currentVersion) {
      consola.success("You're already using the latest version of nuxt.")
    } else {
      consola.success(
        'Successfully upgraded nuxt from',
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
