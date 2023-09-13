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

async function getPackageVersion(
  packageName: string,
  path: string,
): Promise<string | null> {
  try {
    const pkg = await readPackageJSON(packageName, { url: path })
    if (!pkg.version) {
      consola.warn(
        'Cannot find any installed',
        packageName,
        'versions in ',
        path,
      )
    }
    return pkg.version || null
  } catch {
    return null
  }
}

export default defineCommand({
  meta: {
    name: 'upgrade',
    description: 'Upgrade nuxt monorepo packages',
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
      console.error('Cannot detect Package Manager in', cwd)
      process.exit(1)
    }
    const packageManagerVersion = execSync(`${packageManager} --version`)
      .toString('utf8')
      .trim()
    consola.info('Package Manager:', packageManager, packageManagerVersion)

    let nuxtDirsClean = false

    for (const packageName of [
      'nuxt',
      '@nuxt/kit',
      '@nuxt/schema',
      '@nuxt/test-utils',
    ]) {
      // Check currently installed package version
      const currentVersion =
        (await getPackageVersion(packageName, cwd)) || '[unknown]'
      if (currentVersion === '[unknown]' && packageName != 'nuxt') {
        consola.log('Skipping', packageName)
        continue
      }
      consola.info('Current', packageName, 'version:', currentVersion)

      // Force install
      const pmLockFile = resolve(cwd, packageManagerLocks[packageManager])
      const forceRemovals = [
        'node_modules',
        relative(process.cwd(), pmLockFile),
      ]
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

      // Cleanup after upgrade
      if (!nuxtDirsClean) {
        await cleanupNuxtDirs(cwd)
        nuxtDirsClean = true
      }

      // Install latest version
      consola.info('Installing latest', packageName, 'release...')
      execSync(
        `${packageManager} ${
          packageManager === 'yarn' ? 'add' : 'install'
        } -D ${packageName}`,
        { stdio: 'inherit', cwd },
      )

      // Check installed package version again
      const upgradedVersion =
        (await getPackageVersion(packageName, cwd)) || '[unknown]'
      consola.info('Upgraded', packageName, 'version:', upgradedVersion)

      if (upgradedVersion === currentVersion) {
        consola.success(
          "You're already using the latest version of",
          packageName,
          '.',
        )
      } else {
        consola.success(
          'Successfully upgraded',
          packageName,
          'from',
          currentVersion,
          'to',
          upgradedVersion,
        )
        if (packageName == 'nuxt') {
          const commitA = nuxtVersionToGitIdentifier(currentVersion)
          const commitB = nuxtVersionToGitIdentifier(upgradedVersion)
          if (commitA && commitB) {
            consola.info(
              'Changelog:',
              `https://github.com/nuxt/nuxt/compare/${commitA}...${commitB}`,
            )
          }
        }
      }
    }
  },
})
