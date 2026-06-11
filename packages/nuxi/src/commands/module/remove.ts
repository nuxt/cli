import type { PackageJson } from 'pkg-types'

import type { NuxtModule } from './_utils'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { cancel, confirm, isCancel, multiselect } from '@clack/prompts'
import { updateConfig } from 'c12/update'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { detectPackageManager, removeDependency } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'

import { runCommand } from '../../run'
import { logger } from '../../utils/logger'
import { relativeToProcess } from '../../utils/paths'
import { cwdArgs, logLevelArgs } from '../_shared'
import prepareCommand from '../prepare'
import { fetchModules } from './_utils'

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
    skipUninstall: {
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

    if (!projectPkg.dependencies?.nuxt && !projectPkg.devDependencies?.nuxt) {
      logger.warn(`No ${colors.cyan('nuxt')} dependency detected in ${colors.cyan(relativeToProcess(cwd))}.`)

      const shouldContinue = await confirm({
        message: `Do you want to continue anyway?`,
        initialValue: false,
      })

      if (isCancel(shouldContinue) || shouldContinue !== true) {
        process.exit(1)
      }
    }

    if (ctx.args.skipConfig && modules.length === 0) {
      cancel(`Specify one or more modules to remove when ${colors.cyan('--skipConfig')} is set.`)
      process.exit(1)
    }

    // Resolve positional inputs to canonical npm package names. With no inputs, the
    // multiselect picker runs inside `removeModules` against the configured modules.
    const installedNames = new Set([
      ...Object.keys(projectPkg.dependencies || {}),
      ...Object.keys(projectPkg.devDependencies || {}),
    ])

    const needsDB = modules.some(m => !installedNames.has(m))
    const modulesDB: NuxtModule[] = needsDB
      ? await fetchModules().catch((err) => {
          logger.warn(`Cannot search in the Nuxt Modules database: ${err}`)
          return []
        })
      : []

    const resolvedModules = modules.map(m => resolveModule(m, modulesDB, installedNames))

    if (resolvedModules.length > 0) {
      logger.info(`Resolved ${resolvedModules.map(x => colors.cyan(x)).join(', ')}, removing module${resolvedModules.length > 1 ? 's' : ''}...`)
    }

    const proceed = await removeModules(resolvedModules, { ...ctx.args, cwd }, projectPkg)

    if (!proceed) {
      process.exit(0)
    }

    // Run prepare command if uninstall is not skipped
    if (!ctx.args.skipUninstall) {
      const args = Object.entries(ctx.args).filter(([k]) => k in cwdArgs || k in logLevelArgs).map(([k, v]) => `--${k}=${v}`)

      await runCommand(prepareCommand, args)
    }
  },
})

// -- Internal Utils --
async function removeModules(modules: string[], { skipUninstall = false, skipConfig = false, cwd }: { skipUninstall?: boolean, skipConfig?: boolean, cwd: string }, projectPkg: PackageJson): Promise<boolean> {
  const removedFromConfig: string[] = []

  // Update nuxt.config.ts (with picker if no modules were given upfront)
  if (!skipConfig) {
    let configMissing = false
    let cancelled = false

    await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      onCreate() {
        configMissing = true
        return false
      },
      async onUpdate(config) {
        if (!Array.isArray(config.modules)) {
          return
        }

        const present: string[] = []
        for (const item of config.modules) {
          const name = readModuleName(item)
          if (name) {
            present.push(name)
          }
        }

        let toRemove: Set<string>
        if (modules.length === 0) {
          if (present.length === 0) {
            return
          }

          const picked = await multiselect({
            message: 'Select modules to remove:',
            options: present.map(m => ({ value: m, label: m })),
            required: true,
          })

          if (isCancel(picked)) {
            cancelled = true
            return
          }

          toRemove = new Set(picked as string[])
        }
        else {
          toRemove = new Set(modules)
        }

        for (let i = config.modules.length - 1; i >= 0; i--) {
          const name = readModuleName(config.modules[i])
          if (name && toRemove.has(name)) {
            logger.info(`Removing ${colors.cyan(name)} from the ${colors.cyan('modules')}`)
            config.modules.splice(i, 1)
            removedFromConfig.push(name)
          }
        }
      },
    }).catch((error) => {
      if (configMissing) {
        return
      }
      logger.error(`Failed to update ${colors.cyan('nuxt.config')}: ${error.message}`)
      logger.error(`Please manually remove ${colors.cyan(modules.join(', ') || 'the relevant modules')} from the ${colors.cyan('modules')} array in ${colors.cyan('nuxt.config.ts')}`)
    })

    if (cancelled) {
      cancel('No modules selected.')
      return false
    }

    if (modules.length === 0 && removedFromConfig.length === 0) {
      cancel(configMissing
        ? `No ${colors.cyan('nuxt.config')} found in ${colors.cyan(relativeToProcess(cwd))}.`
        : `No modules configured in ${colors.cyan('nuxt.config')}.`)
      return false
    }
  }

  // Remove dependencies
  if (!skipUninstall) {
    const installedModules: string[] = []
    const notInstalledModules: string[] = []

    const dependencies = new Set([
      ...Object.keys(projectPkg.dependencies || {}),
      ...Object.keys(projectPkg.devDependencies || {}),
    ])

    const targets = Array.from(new Set([...modules, ...removedFromConfig]))

    for (const module of targets) {
      if (dependencies.has(module)) {
        installedModules.push(module)
      }
      else {
        notInstalledModules.push(module)
      }
    }

    if (notInstalledModules.length > 0) {
      const notInstalledList = notInstalledModules.map(m => colors.cyan(m)).join(', ')
      const are = notInstalledModules.length > 1 ? 'are' : 'is'
      logger.info(`${notInstalledList} ${are} not installed as a dependency`)
    }

    if (installedModules.length === 0) {
      return true
    }

    const orphanedPeers = await findOrphanedPeers(installedModules, projectPkg, cwd)
    if (orphanedPeers.length > 0) {
      const peersList = orphanedPeers.map(({ peer, source }) =>
        `${colors.cyan(peer)} (peer of ${colors.cyan(source)})`).join(', ')
      const peerDep = orphanedPeers.length > 1 ? 'dependencies' : 'dependency'
      logger.info(`Also removing orphaned peer ${peerDep}: ${peersList}`)
    }

    const allToRemove = [...installedModules, ...orphanedPeers.map(o => o.peer)]
    const removeList = allToRemove.map(m => colors.cyan(m)).join(', ')
    const dependency = allToRemove.length > 1 ? 'dependencies' : 'dependency'
    logger.info(`Uninstalling ${removeList} ${dependency}`)

    const packageManager = await detectPackageManager(cwd)

    await removeDependency(allToRemove, {
      cwd,
      packageManager,
      workspace: packageManager?.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
    }).catch((error) => {
      logger.error(String(error))
      process.exit(1)
    })
  }

  return true
}

function readModuleName(item: unknown): string | null {
  if (typeof item === 'string') {
    return item
  }
  if (Array.isArray(item) && typeof item[0] === 'string') {
    return item[0]
  }
  return null
}

function resolveModule(input: string, modulesDB: NuxtModule[], installed: Set<string>): string {
  if (installed.has(input)) {
    return input
  }

  const matched = modulesDB.find(m =>
    m.name === input
    || m.npm === input
    || m.aliases?.includes(input),
  )

  return matched?.npm || input
}

async function findOrphanedPeers(removing: string[], projectPkg: PackageJson, cwd: string): Promise<OrphanedPeer[]> {
  const projectDeps = new Set([
    ...Object.keys(projectPkg.dependencies || {}),
    ...Object.keys(projectPkg.devDependencies || {}),
  ])
  const removingSet = new Set(removing)

  // peer name -> first removed module that declares it
  const candidates = new Map<string, string>()
  for (const m of removing) {
    const pkg = await readPackageJSON(m, { from: cwd }).catch(() => null)
    if (!pkg?.peerDependencies) {
      continue
    }
    for (const peer of Object.keys(pkg.peerDependencies)) {
      if (!projectDeps.has(peer) || removingSet.has(peer) || candidates.has(peer)) {
        continue
      }
      candidates.set(peer, m)
    }
  }

  if (candidates.size === 0) {
    return []
  }

  // Strike out peers that another retained dep still needs
  const stillNeeded = new Set<string>()
  for (const dep of projectDeps) {
    if (removingSet.has(dep) || candidates.has(dep)) {
      continue
    }
    const depPkg = await readPackageJSON(dep, { from: cwd }).catch(() => null)
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
