import type { PackageJson } from 'pkg-types'

import type { ConfigEntries } from '../../utils/config'
import type { NuxtModule } from './_utils'

import process from 'node:process'

import { styleText } from 'node:util'
import { cancel, confirm, isCancel, multiselect } from '@clack/prompts'
import { defineCommand } from 'citty'
import { detectPackageManager, removeDependency } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'

import { runCommandDef as runCommand } from '../../run-command'
import { readNuxtConfig, removeNuxtConfigEntries } from '../../utils/config'
import { CONFIG_KEYS } from '../../utils/config-parse'
import { logger } from '../../utils/logger'
import { logNetworkError } from '../../utils/network'
import { readDependencyPackageJson } from '../../utils/package-json'
import { relativeToProcess } from '../../utils/paths'
import { cwdArgs, logLevelArgs } from '../_shared'
import prepareCommand from '../prepare'
import { basePackageName, ensureNuxtDependency, fetchModules, forwardCommandArgs, getProjectDependencies, isPnpmWorkspace, MODULES_API_URL } from './_utils'

interface OrphanedPeer {
  peer: string
  source: string
}

export default defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove Nuxt modules',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    moduleName: {
      type: 'positional',
      description: 'Specify one or more modules to remove by name, separated by spaces',
      required: false,
    },
    skipInstall: {
      type: 'boolean',
      description: 'Skip dependency uninstall',
    },
    skipConfig: {
      type: 'boolean',
      description: 'Skip nuxt.config.ts update',
    },
  },
  async setup(ctx) {
    const cwd = resolve(ctx.args.cwd)
    const modules = ctx.args._.map(e => e.trim()).filter(Boolean)
    const projectPkg = await readPackageJSON(cwd).catch(() => ({} as PackageJson))

    if (!await ensureNuxtDependency(cwd, projectPkg)) {
      process.exit(1)
    }

    if (ctx.args.skipConfig && modules.length === 0) {
      cancel(`Specify one or more modules to remove when ${styleText('cyan', '--skipConfig')} is set.`)
      process.exit(1)
    }

    const installedNames = getProjectDependencies(projectPkg)

    const needsDB = modules.some(m => !installedNames.has(m) && !installedNames.has(basePackageName(m)))
    const modulesDB: NuxtModule[] = needsDB
      ? await fetchModules().catch((err) => {
          logNetworkError(err, { url: MODULES_API_URL, level: 'warn', prefix: 'Cannot search in the Nuxt Modules database.' })
          return []
        })
      : []

    const resolvedModules = modules.map(m => resolveModuleName(m, modulesDB, installedNames))

    if (resolvedModules.length > 0) {
      logger.info(`Resolved ${resolvedModules.map(x => styleText('cyan', x)).join(', ')}, removing...`)
    }

    const proceed = await removeModules(resolvedModules, { ...ctx.args, cwd }, projectPkg)

    if (proceed !== true) {
      process.exit(proceed === false ? 1 : 0)
    }

    if (!ctx.args.skipInstall) {
      await runCommand(prepareCommand, forwardCommandArgs(ctx.args))
    }
  },
})

// -- Internal Utils --
async function removeModules(modules: string[], { skipInstall = false, skipConfig = false, cwd }: { skipInstall?: boolean, skipConfig?: boolean, cwd: string }, projectPkg: PackageJson): Promise<boolean | undefined> {
  const removedFromConfig: string[] = []
  const dependencies = getProjectDependencies(projectPkg)

  if (!skipConfig) {
    const config = await readNuxtConfig(cwd).catch((error) => {
      logger.error(`Failed to read ${styleText('cyan', 'nuxt.config')}: ${(error as Error).message}`)
      return undefined
    })

    const present = config ? CONFIG_KEYS.flatMap(key => config[key]) : []

    let toRemove = new Set(modules)
    if (config && modules.length === 0 && present.length > 0) {
      const picked = await multiselect({
        message: 'Select modules to remove:',
        options: present.map(m => ({ value: m, label: m })),
        required: true,
      })

      if (isCancel(picked)) {
        cancel('No modules selected.')
        return
      }

      toRemove = new Set(picked as string[])
    }

    if (config) {
      const doomed: ConfigEntries = {}
      for (const key of CONFIG_KEYS) {
        // A package may be configured through a subpath (`maz-ui/nuxt`) while the
        // user asks to remove the package itself.
        const names = config[key].filter(name => toRemove.has(name) || toRemove.has(basePackageName(name)))
        if (!names.length) {
          continue
        }
        for (const name of names) {
          logger.info(`Removing ${styleText('cyan', name)} from the ${styleText('cyan', key)}`)
        }
        doomed[key] = names
        removedFromConfig.push(...names)
      }

      try {
        await removeNuxtConfigEntries(config, doomed)
      }
      catch (error) {
        logger.error(`Failed to update ${styleText('cyan', 'nuxt.config')}: ${(error as Error).message}`)
        logger.error(`Please manually remove ${styleText('cyan', [...toRemove].join(', ') || 'the relevant modules')} from ${styleText('cyan', 'nuxt.config.ts')}`)
        return false
      }
    }

    if (modules.length === 0 && removedFromConfig.length === 0) {
      cancel(config
        ? `No modules configured in ${styleText('cyan', 'nuxt.config')}.`
        : `No ${styleText('cyan', 'nuxt.config')} found in ${styleText('cyan', relativeToProcess(cwd))}.`)
      return
    }
  }

  if (!skipInstall) {
    const installedModules: string[] = []
    const notInstalledModules: string[] = []

    // Entries removed from the config are only uninstalled when they name an
    // installed package, so a local layer (`./layers/admin`) is left alone.
    const targets = Array.from(new Set([
      ...modules,
      ...removedFromConfig.map(basePackageName).filter(name => dependencies.has(name)),
    ]))

    for (const module of targets) {
      if (dependencies.has(module)) {
        installedModules.push(module)
      }
      else {
        notInstalledModules.push(module)
      }
    }

    if (notInstalledModules.length > 0) {
      const notInstalledList = notInstalledModules.map(m => styleText('cyan', m)).join(', ')
      const are = notInstalledModules.length > 1 ? 'are' : 'is'
      logger.info(`${notInstalledList} ${are} not installed as a dependency`)
    }

    if (installedModules.length === 0) {
      return true
    }

    const toRemove = [...installedModules]

    const orphanedPeers = await findOrphanedPeers(installedModules, projectPkg, cwd)
    if (orphanedPeers.length > 0) {
      const peersList = orphanedPeers.map(({ peer, source }) =>
        `${styleText('cyan', peer)} (peer of ${styleText('cyan', source)})`).join(', ')
      const peerDep = orphanedPeers.length > 1 ? 'dependencies' : 'dependency'
      const them = orphanedPeers.length > 1 ? 'them' : 'it'

      logger.info(`The following peer ${peerDep} ${orphanedPeers.length > 1 ? 'are' : 'is'} no longer used by any other dependency: ${peersList}`)

      const alsoRemove = await confirm({
        message: `Do you also want to remove ${them}?`,
        initialValue: false,
      })

      if (isCancel(alsoRemove)) {
        cancel('Aborted.')
        return
      }

      if (alsoRemove) {
        toRemove.push(...orphanedPeers.map(o => o.peer))
      }
    }

    const removeList = toRemove.map(m => styleText('cyan', m)).join(', ')
    const dependency = toRemove.length > 1 ? 'dependencies' : 'dependency'
    logger.info(`Uninstalling ${removeList} ${dependency}`)

    const packageManager = await detectPackageManager(cwd)

    const removed = await removeDependency(toRemove, {
      cwd,
      packageManager,
      workspace: isPnpmWorkspace(packageManager, cwd),
    }).then(() => true).catch((error) => {
      logger.error(String(error))
      return false
    })

    if (!removed) {
      return false
    }
  }

  return true
}

function resolveModuleName(input: string, modulesDB: NuxtModule[], installed: Set<string>): string {
  if (installed.has(input)) {
    return input
  }

  const base = basePackageName(input)
  if (installed.has(base)) {
    return base
  }

  const matched = modulesDB.find(m =>
    m.name === input
    || m.npm === input
    || m.aliases?.includes(input),
  )

  return matched?.npm ? basePackageName(matched.npm) : input
}

async function findOrphanedPeers(removing: string[], projectPkg: PackageJson, cwd: string): Promise<OrphanedPeer[]> {
  const projectDeps = getProjectDependencies(projectPkg)
  const removingSet = new Set(removing)

  const candidates = new Map<string, string>()
  for (const m of removing) {
    const pkg = await readDependencyPackageJson(m, cwd)
    if (!pkg?.peerDependencies) {
      continue
    }
    for (const peer of Object.keys(pkg.peerDependencies)) {
      if (pkg.peerDependenciesMeta?.[peer]?.optional || !projectDeps.has(peer) || removingSet.has(peer) || candidates.has(peer)) {
        continue
      }
      candidates.set(peer, m)
    }
  }

  if (candidates.size === 0) {
    return []
  }

  const stillNeeded = new Set<string>()
  const retained = [...projectDeps].filter(dep => !removingSet.has(dep) && !candidates.has(dep))
  const packages = await Promise.all(retained.map(dep => readDependencyPackageJson(dep, cwd)))
  for (const depPkg of packages) {
    if (!depPkg) {
      continue
    }
    const depDeps = new Set([
      ...Object.keys(depPkg.dependencies || {}),
      ...Object.keys(depPkg.peerDependencies || {}),
    ])
    for (const peer of candidates.keys()) {
      if (depDeps.has(peer)) {
        stillNeeded.add(peer)
      }
    }
  }

  const orphans: OrphanedPeer[] = []
  for (const [peer, source] of candidates) {
    if (!stillNeeded.has(peer)) {
      orphans.push({ peer, source })
    }
  }
  return orphans
}
