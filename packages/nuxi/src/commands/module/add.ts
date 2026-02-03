import type { FileHandle } from 'node:fs/promises'
import type { PackageJson } from 'pkg-types'
import type { BundledSkillSource } from 'unagent'
import type { ModuleSkillSource } from './_skills'

import type { NuxtModule } from './_utils'
import * as fs from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import process from 'node:process'
import { cancel, confirm, isCancel, select, spinner } from '@clack/prompts'
import { updateConfig } from 'c12/update'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { addDependency, detectPackageManager } from 'nypm'
import { $fetch } from 'ofetch'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { satisfies } from 'semver'
import { joinURL } from 'ufo'
import { formatSkillNames, getBundledSkillSources } from 'unagent'

import { runCommand } from '../../run'
import { logger } from '../../utils/logger'
import { relativeToProcess } from '../../utils/paths'
import { getNuxtVersion } from '../../utils/versions'
import { cwdArgs, logLevelArgs } from '../_shared'
import prepareCommand from '../prepare'
import { detectModuleSkills, installModuleSkills } from './_skills'
import { checkNuxtCompatibility, fetchModules, getRegistryFromContent } from './_utils'

interface RegistryMeta {
  registry: string
  authToken: string | null
}

interface ResolvedModule {
  nuxtModule?: NuxtModule
  pkg: string
  pkgName: string
  pkgVersion: string
}
type UnresolvedModule = false
type ModuleResolution = ResolvedModule | UnresolvedModule

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add Nuxt modules',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    moduleName: {
      type: 'positional',
      description: 'Specify one or more modules to install by name, separated by spaces',
    },
    skipInstall: {
      type: 'boolean',
      description: 'Skip npm install',
    },
    skipConfig: {
      type: 'boolean',
      description: 'Skip nuxt.config.ts update',
    },
    dev: {
      type: 'boolean',
      description: 'Install modules as dev dependencies',
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

    const resolvedModules: ResolvedModule[] = []
    for (const moduleName of modules) {
      const resolvedModule = await resolveModule(moduleName, cwd)
      if (resolvedModule) {
        resolvedModules.push(resolvedModule)
      }
    }

    if (resolvedModules.length === 0) {
      cancel('No modules to add.')
      process.exit(1)
    }

    logger.info(`Resolved ${resolvedModules.map(x => colors.cyan(x.pkgName)).join(', ')}, adding module${resolvedModules.length > 1 ? 's' : ''}...`)

    await addModules(resolvedModules, { ...ctx.args, cwd }, projectPkg)

    if (!ctx.args.skipInstall) {
      let skillInfos: ModuleSkillSource[] = []
      const moduleNames = resolvedModules.map(m => m.pkgName)
      const checkSpinner = spinner()
      checkSpinner.start('Checking for agent skills...')
      try {
        // Check for agent skills (bundled in node_modules or via module meta)
        const bundledSources: BundledSkillSource[] = getBundledSkillSources(cwd).filter((s: BundledSkillSource) => moduleNames.includes(s.packageName))
        const bundledSkills: ModuleSkillSource[] = bundledSources.map((s: BundledSkillSource) => ({
          source: s.source,
          skills: s.skills,
          label: s.packageName,
          moduleName: s.packageName,
          isLocal: true,
          mode: 'symlink' as const,
        }))
        const metaSkills = await detectModuleSkills(moduleNames, cwd)

        // Prefer bundled over remote
        const bundledModules = new Set(bundledSkills.map(s => s.moduleName))
        const remoteOnly = metaSkills.filter(s => !bundledModules.has(s.moduleName))
        skillInfos = [...bundledSkills, ...remoteOnly]

        checkSpinner.stop(skillInfos.length > 0 ? `Found ${skillInfos.length} skill(s)` : 'No skills found')
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        checkSpinner.stop('Skipped agent skills check')
        logger.warn(`Failed to check agent skills: ${message}`)
      }

      if (skillInfos.length > 0) {
        const shouldInstall = await confirm({
          message: `Install agent skill(s): ${formatSkillNames(skillInfos)}?`,
          initialValue: true,
        })

        if (!isCancel(shouldInstall) && shouldInstall) {
          try {
            await installModuleSkills(skillInfos)
          }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`Failed to install agent skills: ${message}`)
          }
        }
      }

      // Run prepare command
      const args = Object.entries(ctx.args).filter(([k]) => k in cwdArgs || k in logLevelArgs).map(([k, v]) => `--${k}=${v}`)
      await runCommand(prepareCommand, args)
    }
  },
})

// -- Internal Utils --
async function addModules(modules: ResolvedModule[], { skipInstall, skipConfig, cwd, dev }: { skipInstall: boolean, skipConfig: boolean, cwd: string, dev: boolean }, projectPkg: PackageJson) {
  // Add dependencies
  if (!skipInstall) {
    const installedModules: ResolvedModule[] = []
    const notInstalledModules: ResolvedModule[] = []

    const dependencies = new Set([
      ...Object.keys(projectPkg.dependencies || {}),
      ...Object.keys(projectPkg.devDependencies || {}),
    ])

    for (const module of modules) {
      if (dependencies.has(module.pkgName)) {
        installedModules.push(module)
      }
      else {
        notInstalledModules.push(module)
      }
    }

    if (installedModules.length > 0) {
      const installedModulesList = installedModules.map(module => colors.cyan(module.pkgName)).join(', ')
      const are = installedModules.length > 1 ? 'are' : 'is'
      logger.info(`${installedModulesList} ${are} already installed`)
    }

    if (notInstalledModules.length > 0) {
      const isDev = Boolean(projectPkg.devDependencies?.nuxt) || dev

      const notInstalledModulesList = notInstalledModules.map(module => colors.cyan(module.pkg)).join(', ')
      const dependency = notInstalledModules.length > 1 ? 'dependencies' : 'dependency'
      const a = notInstalledModules.length > 1 ? '' : ' a'
      logger.info(`Installing ${notInstalledModulesList} as${a}${isDev ? ' development' : ''} ${dependency}`)

      const packageManager = await detectPackageManager(cwd)

      const res = await addDependency(notInstalledModules.map(module => module.pkg), {
        cwd,
        dev: isDev,
        installPeerDependencies: true,
        packageManager,
        workspace: packageManager?.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
      }).then(() => true).catch(
        async (error) => {
          logger.error(error)

          const failedModulesList = notInstalledModules.map(module => colors.cyan(module.pkg)).join(', ')
          const s = notInstalledModules.length > 1 ? 's' : ''
          const result = await confirm({
            message: `Install failed for ${failedModulesList}. Do you want to continue adding the module${s} to ${colors.cyan('nuxt.config')}?`,
            initialValue: false,
          })

          if (isCancel(result)) {
            return false
          }

          return result
        },
      )

      if (res !== true) {
        return
      }
    }
  }

  // Update nuxt.config.ts
  if (!skipConfig) {
    await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      async onCreate() {
        logger.info(`Creating ${colors.cyan('nuxt.config.ts')}`)

        return getDefaultNuxtConfig()
      },
      async onUpdate(config) {
        if (!config.modules) {
          config.modules = []
        }

        for (const resolved of modules) {
          if (config.modules.includes(resolved.pkgName)) {
            logger.info(`${colors.cyan(resolved.pkgName)} is already in the ${colors.cyan('modules')}`)

            continue
          }

          logger.info(`Adding ${colors.cyan(resolved.pkgName)} to the ${colors.cyan('modules')}`)

          config.modules.push(resolved.pkgName)
        }
      },
    }).catch((error) => {
      logger.error(`Failed to update ${colors.cyan('nuxt.config')}: ${error.message}`)
      logger.error(`Please manually add ${colors.cyan(modules.map(module => module.pkgName).join(', '))} to the ${colors.cyan('modules')} in ${colors.cyan('nuxt.config.ts')}`)

      return null
    })
  }
}

function getDefaultNuxtConfig() {
  return `
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: []
})`
}

// Based on https://github.com/dword-design/package-name-regex
const packageRegex
  = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?([a-z0-9-~][a-z0-9-._~]*)(@[^@]+)?$/

async function resolveModule(moduleName: string, cwd: string): Promise<ModuleResolution> {
  let pkgName = moduleName
  let pkgVersion: string | undefined

  const reMatch = moduleName.match(packageRegex)
  if (reMatch) {
    if (reMatch[3]) {
      pkgName = `${reMatch[1] || ''}${reMatch[2] || ''}`
      pkgVersion = reMatch[3].slice(1)
    }
  }
  else {
    logger.error(`Invalid package name ${colors.cyan(pkgName)}.`)
    return false
  }

  const modulesDB = await fetchModules().catch((err) => {
    logger.warn(`Cannot search in the Nuxt Modules database: ${err}`)
    return []
  })

  const matchedModule = modulesDB.find(
    module =>
      module.name === moduleName
      || (pkgVersion && module.name === pkgName)
      || module.npm === pkgName
      || module.aliases?.includes(pkgName),
  )

  if (matchedModule?.npm) {
    pkgName = matchedModule.npm
  }

  if (matchedModule && matchedModule.compatibility.nuxt) {
    // Get local Nuxt version
    const nuxtVersion = await getNuxtVersion(cwd)

    // Check for Module Compatibility
    if (!checkNuxtCompatibility(matchedModule, nuxtVersion)) {
      logger.warn(
        `The module ${colors.cyan(pkgName)} is not compatible with Nuxt ${colors.cyan(nuxtVersion)} (requires ${colors.cyan(matchedModule.compatibility.nuxt)})`,
      )
      const shouldContinue = await confirm({
        message: 'Do you want to continue installing incompatible version?',
        initialValue: false,
      })
      if (isCancel(shouldContinue) || !shouldContinue) {
        return false
      }
    }

    // Match corresponding version of module for local Nuxt version
    const versionMap = matchedModule.compatibility.versionMap
    if (versionMap) {
      for (const [_nuxtVersion, _moduleVersion] of Object.entries(versionMap)) {
        if (satisfies(nuxtVersion, _nuxtVersion)) {
          if (!pkgVersion) {
            pkgVersion = _moduleVersion
          }
          else {
            logger.warn(
              `Recommended version of ${colors.cyan(pkgName)} for Nuxt ${colors.cyan(nuxtVersion)} is ${colors.cyan(_moduleVersion)} but you have requested ${colors.cyan(pkgVersion)}.`,
            )
            const result = await select({
              message: 'Choose a version:',
              options: [
                { value: _moduleVersion, label: _moduleVersion },
                { value: pkgVersion, label: pkgVersion },
              ],
            })
            if (isCancel(result)) {
              return false
            }
            pkgVersion = result
          }
          break
        }
      }
    }
  }

  // Fetch package on npm
  let version = pkgVersion || 'latest'
  const pkgScope = pkgName.startsWith('@') ? pkgName.split('/')[0]! : null
  const meta: RegistryMeta = await detectNpmRegistry(pkgScope)
  const headers: HeadersInit = {}

  if (meta.authToken) {
    headers.Authorization = `Bearer ${meta.authToken}`
  }

  // TODO: spinner
  const pkgDetails = await $fetch(joinURL(meta.registry, `${pkgName}`), { headers }).catch(() => null)
  if (!pkgDetails) {
    logger.error(`Failed to fetch package details for ${colors.cyan(pkgName)}.`)
    return false
  }

  // fully resolve the version
  if (pkgDetails['dist-tags']?.[version]) {
    version = pkgDetails['dist-tags'][version]
  }
  else {
    version = Object.keys(pkgDetails.versions)?.findLast(v => satisfies(v, version)) || version
  }

  const pkg = pkgDetails.versions[version!] || {}

  const pkgDependencies = Object.assign(
    pkg.dependencies || {},
    pkg.devDependencies || {},
  )
  if (
    !pkgDependencies.nuxt
    && !pkgDependencies['nuxt-edge']
    && !pkgDependencies['@nuxt/kit']
  ) {
    logger.warn(`It seems that ${colors.cyan(pkgName)} is not a Nuxt module.`)
    const shouldContinue = await confirm({
      message: `Do you want to continue installing ${colors.cyan(pkgName)} anyway?`,
      initialValue: false,
    })
    if (isCancel(shouldContinue) || !shouldContinue) {
      return false
    }
  }

  return {
    nuxtModule: matchedModule,
    pkg: `${pkgName}@${version}`,
    pkgName,
    pkgVersion: version,
  }
}

function getNpmrcPaths(): string[] {
  const userNpmrcPath = join(homedir(), '.npmrc')
  const cwdNpmrcPath = join(process.cwd(), '.npmrc')

  return [cwdNpmrcPath, userNpmrcPath]
}

async function getAuthToken(registry: RegistryMeta['registry']): Promise<RegistryMeta['authToken']> {
  const paths = getNpmrcPaths()
  const authTokenRegex = new RegExp(`^//${registry.replace(/^https?:\/\//, '').replace(/\/$/, '')}/:_authToken=(.+)$`, 'm')

  for (const npmrcPath of paths) {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        const npmrcContent = await fd.readFile('utf-8')
        const authTokenMatch = npmrcContent.match(authTokenRegex)?.[1]

        if (authTokenMatch) {
          return authTokenMatch.trim()
        }
      }
    }
    catch {
      // swallow errors as file does not exist
    }
    finally {
      await fd?.close()
    }
  }

  return null
}

async function detectNpmRegistry(scope: string | null): Promise<RegistryMeta> {
  const registry = await getRegistry(scope)
  const authToken = await getAuthToken(registry)

  return {
    registry,
    authToken,
  }
}

async function getRegistry(scope: string | null): Promise<string> {
  if (process.env.COREPACK_NPM_REGISTRY) {
    return process.env.COREPACK_NPM_REGISTRY
  }
  const registry = await getRegistryFromFile(getNpmrcPaths(), scope)

  if (registry) {
    process.env.COREPACK_NPM_REGISTRY = registry
  }

  return registry || 'https://registry.npmjs.org'
}

async function getRegistryFromFile(paths: string[], scope: string | null) {
  for (const npmrcPath of paths) {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        const npmrcContent = await fd.readFile('utf-8')
        const registry = getRegistryFromContent(npmrcContent, scope)

        if (registry) {
          return registry
        }
      }
    }
    catch {
      // swallow errors as file does not exist
    }
    finally {
      await fd?.close()
    }
  }
  return null
}
