import { execSync } from 'node:child_process'
import { consola } from 'consola'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import {
  getPackageManager,
  packageManagerLocks,
} from '../utils/packageManagers'
import { rmRecursive, touchFile } from '../utils/fs'
import { cleanupNuxtDirs, nuxtVersionToGitIdentifier } from '../utils/nuxt'
import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

interface NuxtPackage {
  version: string | null
  name: string | null
  alias: string | null
  edge: boolean
  major: number
}

const isFilled = <T extends {}>(
  v: PromiseSettledResult<T>,
): v is PromiseFulfilledResult<T> => v.status === 'fulfilled'

function detectNuxtEdge(nuxtVersion: string): boolean {
  try {
    return /-\d{8}.[a-z0-9]{7}/.test(nuxtVersion)
  } catch {
    return false
  }
}

function detectMajorVersion(nuxtVersion: string): number {
  try {
    return parseInt(nuxtVersion.split('.')[0])
  } catch {
    // fallback to Nuxt 3
    return 3
  }
}

function getNpmTag(nuxtPackage: NuxtPackage): string {
  // later we can extend support in case of using nuxt-edge for Nuxt 3
  if (nuxtPackage.name !== nuxtPackage.alias) {
    return `npm:${nuxtPackage.alias}@latest`
  }
  if (!nuxtPackage.edge && nuxtPackage.major === 2) {
    return '2x'
  }
  return 'latest'
}

async function getNuxtPackage(path: string): Promise<NuxtPackage> {
  try {
    const possiblePackages = ['nuxt-edge', 'nuxt', 'nuxt3']
    // Promise.any will be better, but it requires Node 15+
    const pkgs = await Promise.allSettled(
      possiblePackages.map((name) => readPackageJSON(name, { url: path })),
    )

    const pkg = pkgs.find(isFilled)!.value || {}

    if (!pkg.version) {
      consola.warn('Cannot find any installed nuxt versions in ', path)
    }

    const nuxtPackage = {
      version: pkg.version || null,
      name: pkg._name || 'nuxt',
      alias: pkg.name || null,
      edge: detectNuxtEdge(pkg.version || ''),
      major: detectMajorVersion(pkg.version || ''),
    }
    return nuxtPackage
  } catch {
    // Even if we cannot read package.json, we can still upgrade to latest Nuxt 3
    return {
      version: null,
      name: 'nuxt',
      alias: null,
      edge: false,
      major: 3,
    }
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
      console.error('Cannot detect Package Manager in', cwd)
      process.exit(1)
    }
    const packageManagerVersion = execSync(`${packageManager} --version`)
      .toString('utf8')
      .trim()
    consola.info('Package Manager:', packageManager, packageManagerVersion)

    // Check currently installed nuxt version
    const currentNuxt = await getNuxtPackage(cwd)

    // Warn user to add alias to nuxt3 package or install stable rc version
    if (currentNuxt.name === 'nuxt3') {
      consola.warn(
        '`nuxt3` package usage without alias is removed.\nPlease, update your code to continue working with new releases.\nSee more: https://github.com/nuxt/nuxt/pull/4449',
      )
    }

    consola.info(`Current nuxt version: ${currentNuxt.version}`)
    if (currentNuxt.edge) {
      consola.info('Edge release channel detected')
    }

    // Force install
    if (ctx.args.force) {
      consola.info('Removing lock-file and node_modules...')
      const pmLockFile = resolve(cwd, packageManagerLocks[packageManager])
      await rmRecursive([pmLockFile, resolve(cwd, 'node_modules')])
      await touchFile(pmLockFile)
    }

    // Install latest version
    consola.info(`Installing latest Nuxt ${currentNuxt.major} release...`)
    execSync(
      `${packageManager} ${packageManager === 'yarn' ? 'add' : 'install'} -D ${
        currentNuxt.name
      }@${getNpmTag(currentNuxt)}`,
      { stdio: 'inherit', cwd },
    )

    // Cleanup after upgrade
    await cleanupNuxtDirs(cwd)

    // Check installed nuxt version again
    const upgradedNuxt = (await getNuxtPackage(cwd)) || '[unknown]'
    consola.info('Upgraded nuxt version:', upgradedNuxt.version)

    if (upgradedNuxt.version === currentNuxt.version) {
      consola.success("You're already using the latest version of nuxt.")
    } else {
      consola.success(
        'Successfully upgraded nuxt from',
        currentNuxt.version,
        'to',
        upgradedNuxt.version,
      )
      const commitA = nuxtVersionToGitIdentifier(currentNuxt.version || '')
      const commitB = nuxtVersionToGitIdentifier(upgradedNuxt.version || '')
      if (commitA && commitB) {
        consola.info(
          'Changelog:',
          `https://github.com/nuxt/nuxt/compare/${commitA}...${commitB}`,
        )
      }
    }
  },
})
