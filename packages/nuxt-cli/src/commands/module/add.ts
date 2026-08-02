import type { PackageManager } from 'nypm'
import type { PackageJson } from 'pkg-types'

import type { ConfigEntries } from '../../utils/config'
import type { RegistryMeta } from '../../utils/registry'
import type { NuxtModule } from './_utils'
import process from 'node:process'

import { styleText } from 'node:util'
import { cancel, confirm, isCancel, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { detectPackageManager, packageManagers } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { joinURL } from 'ufo'
import { findMaxSatisfying, satisfies } from 'verkit'

import { runCommandDef as runCommand } from '../../run-command'
import { addNuxtConfigEntries, createNuxtConfig, readNuxtConfig } from '../../utils/config'
import { fetchJson } from '../../utils/fetch'
import { createInstallLog, resolvePackageManagerDescriptor, runInstall, takeUnreportedIgnoredBuilds } from '../../utils/install'
import { logger } from '../../utils/logger'
import { logNetworkError } from '../../utils/network'
import { detectNpmRegistry } from '../../utils/registry'
import { getNuxtVersion } from '../../utils/versions'
import { cwdArgs, logLevelArgs } from '../_shared'
import prepareCommand from '../prepare'
import { selectModulesAutocomplete } from './_autocomplete'
import { basePackageName, checkNuxtCompatibility, ensureNuxtDependency, fetchModules, forwardCommandArgs, getProjectDependencies, isPnpmWorkspace, MODULES_API_URL, parseModuleSpec, resolveModuleEntry } from './_utils'

const WHITESPACE_RE = /\s/

interface ResolvedModule {
  nuxtModule?: NuxtModule
  pkg: string
  pkgName: string
  pkgVersion: string
  /** Specifier to write to `nuxt.config`, which may include a subpath. */
  specifier: string
  /** Whether the package is a Nuxt layer, and so belongs in `extends`. */
  isLayer?: boolean
  peerDependencies?: Record<string, string>
  optionalPeerDependencies?: string[]
}
type UnresolvedModule = false
type ModuleResolution = ResolvedModule | UnresolvedModule

/**
 * `layers` only affects help text: `nuxt add` is documented as accepting layers as
 * well as modules, whereas the `nuxt module` namespace documents modules alone.
 */
export function defineAddCommand({ layers = false }: { layers?: boolean } = {}) {
  return defineCommand({
    meta: {
      name: 'add',
      description: layers ? 'Add Nuxt modules and layers' : 'Add Nuxt modules',
    },
    args: {
      ...cwdArgs,
      ...logLevelArgs,
      moduleName: {
        type: 'positional',
        description: `Specify one or more modules${layers ? ' or layers' : ''} to install by name, separated by spaces`,
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
      packageManager: {
        type: 'string',
        description: `Package manager to install with (${packageManagers.map(pm => pm.name).join(', ')})`,
      },
    },
    async setup(ctx) {
      const cwd = resolve(ctx.args.cwd)
      let modules = ctx.args._.map(e => e.trim()).filter(Boolean)
      const projectPkg = await readPackageJSON(cwd).catch(() => ({} as PackageJson))

      if (!await ensureNuxtDependency(cwd, projectPkg)) {
        process.exit(1)
      }

      let modulesDB: NuxtModule[]
      if (modules.length === 0) {
        const modulesSpinner = spinner()
        modulesSpinner.start('Fetching available modules')

        const [allModules, nuxtVersion] = await Promise.all([
          fetchModules().catch((err) => {
            modulesSpinner.error('Failed to fetch available modules')
            logNetworkError(err, { url: MODULES_API_URL })
            process.exit(1)
          }),
          getNuxtVersion(cwd),
        ])

        modulesDB = allModules
        const compatibleModules = modulesDB.filter(m =>
          !m.compatibility.nuxt || checkNuxtCompatibility(m, nuxtVersion),
        )

        modulesSpinner.stop('Modules loaded')

        const selection = await selectModulesAutocomplete({
          modules: compatibleModules,
          message: 'Search modules to add (Esc to finish):',
        })
        modules = selection.selected

        if (modules.length === 0) {
          cancel('No modules selected.')
          process.exit(0)
        }
      }
      else {
        modulesDB = await fetchModules().catch((err) => {
          logNetworkError(err, { url: MODULES_API_URL, level: 'warn', prefix: 'Cannot search in the Nuxt Modules database.' })
          return []
        })
      }

      let nuxtVersionPromise: Promise<string> | undefined
      const getProjectNuxtVersion = () => nuxtVersionPromise ||= getNuxtVersion(cwd)
      const resolvedModules: ResolvedModule[] = []
      for (const moduleName of new Set(modules)) {
        const resolvedModule = await resolveModule(moduleName, cwd, modulesDB, getProjectNuxtVersion)
        if (resolvedModule) {
          resolvedModules.push(resolvedModule)
        }
      }

      if (resolvedModules.length === 0) {
        cancel('No modules to add.')
        process.exit(1)
      }

      logger.info(`Resolved ${resolvedModules.map(x => styleText('cyan', x.specifier)).join(', ')}, adding ${describeModules(resolvedModules)}...`)

      const added = await addModules(resolvedModules, { ...ctx.args, cwd }, projectPkg)

      if (!added) {
        process.exit(1)
      }

      if (!ctx.args.skipInstall) {
        await runCommand(prepareCommand, forwardCommandArgs(ctx.args))
      }
    },
  })
}

export default defineAddCommand()

// -- Internal Utils --
async function addModules(modules: ResolvedModule[], { skipInstall = false, skipConfig = false, cwd, dev = false, packageManager: packageManagerName, logLevel }: { skipInstall?: boolean, skipConfig?: boolean, cwd: string, dev?: boolean, packageManager?: string, logLevel?: string }, projectPkg: PackageJson): Promise<boolean> {
  if (!skipInstall) {
    const installedModules: ResolvedModule[] = []
    const notInstalledModules: ResolvedModule[] = []

    const dependencies = getProjectDependencies(projectPkg)

    for (const module of modules) {
      if (dependencies.has(module.pkgName)) {
        installedModules.push(module)
      }
      else {
        notInstalledModules.push(module)
      }
    }

    if (installedModules.length > 0) {
      const installedModulesList = installedModules.map(module => styleText('cyan', module.pkgName)).join(', ')
      const are = installedModules.length > 1 ? 'are' : 'is'
      logger.info(`${installedModulesList} ${are} already installed`)
    }

    if (notInstalledModules.length > 0) {
      const isDev = Boolean(projectPkg.devDependencies?.nuxt) || dev

      const notInstalledModulesList = notInstalledModules.map(module => styleText('cyan', module.pkg)).join(', ')
      const dependency = notInstalledModules.length > 1 ? 'dependencies' : 'dependency'
      const a = notInstalledModules.length > 1 ? '' : ' a'
      logger.info(`Installing ${notInstalledModulesList} as${a}${isDev ? ' development' : ''} ${dependency}`)

      const packageManager = await resolvePackageManager(cwd, packageManagerName)

      const peers = resolveRequiredPeerDependencies(notInstalledModules, dependencies)
      if (peers.length > 0) {
        logger.info(`Also installing required peer ${peers.length > 1 ? 'dependencies' : 'dependency'} ${peers.map(peer => styleText('cyan', peer)).join(', ')}`)
      }

      const verbose = logLevel === 'verbose' || Boolean(process.env.DEBUG)
      const installController = new AbortController()
      const installLog = createInstallLog({ verbose })
      const installSpinner = spinner({
        indicator: 'timer',
        onCancel: () => installController.abort(),
      })
      installSpinner.start(`Installing with ${styleText('cyan', packageManager.name)}`)

      const result = await runInstall({
        cwd,
        packageManager,
        dependencies: [...notInstalledModules.map(module => module.pkg), ...peers],
        dev: isDev,
        workspace: isPnpmWorkspace(packageManager, cwd),
        onOutput: installLog.onOutput,
        onStatus: message => installSpinner.message(message),
        signal: installController.signal,
      })

      if (!result.success) {
        installSpinner.error(result.error ?? 'Install failed')
        installLog.finish(result)
        // Adding modules to `nuxt.config` without their packages installed
        // leaves a project that cannot boot, so stop here instead.
        logger.info(`${styleText('cyan', 'nuxt.config')} was left unchanged. Resolve the install error and try again.`)
        return false
      }

      installSpinner.stop('Dependencies installed')
      installLog.finish(result)

      const ignoredBuilds = takeUnreportedIgnoredBuilds(result.ignoredBuilds)
      if (ignoredBuilds.length > 0 && packageManager.name === 'pnpm') {
        logger.warn(`${styleText('cyan', 'pnpm')} did not run build scripts for ${ignoredBuilds.map(name => styleText('cyan', name)).join(', ')}. Run ${styleText('cyan', 'pnpm approve-builds')} if your project needs them.`)
      }
    }
  }

  if (!skipConfig) {
    try {
      let config = await readNuxtConfig(cwd)
      if (!config) {
        logger.info(`Creating ${styleText('cyan', 'nuxt.config.ts')}`)
        config = await createNuxtConfig(cwd, getDefaultNuxtConfig())
      }

      const toAdd: ConfigEntries = {}
      for (const resolved of modules) {
        const key = resolved.isLayer ? 'extends' : 'modules'
        if (config[key].includes(resolved.specifier)) {
          logger.info(`${styleText('cyan', resolved.specifier)} is already in the ${styleText('cyan', key)}`)

          continue
        }

        logger.info(`Adding ${styleText('cyan', resolved.specifier)} to the ${styleText('cyan', key)}`)

        toAdd[key] = [...toAdd[key] ?? [], resolved.specifier]
      }

      await addNuxtConfigEntries(config, toAdd)
    }
    catch (error) {
      logger.error(`Failed to update ${styleText('cyan', 'nuxt.config')}: ${(error as Error).message}`)
      logger.error(`Please manually add ${styleText('cyan', modules.map(module => module.specifier).join(', '))} to ${styleText('cyan', 'nuxt.config.ts')}`)
      return false
    }
  }

  return true
}

/**
 * Resolve the package manager to install with, preferring an explicit choice
 * (e.g. the one selected during `nuxt init`) and otherwise detecting one from
 * the project itself before looking at parent directories, so a project nested
 * inside another workspace is not installed with that workspace's package
 * manager.
 */
async function resolvePackageManager(cwd: string, name?: string): Promise<PackageManager> {
  const requested = name ? packageManagers.find(pm => pm.name === name) : undefined
  if (name && !requested) {
    logger.warn(`Unknown package manager ${styleText('cyan', name)}, detecting one instead.`)
  }

  const detected = await detectPackageManager(cwd, { includeParentDirs: false })
    ?? await detectPackageManager(cwd)

  if (!requested) {
    return detected ?? resolvePackageManagerDescriptor('npm')
  }

  // The detected descriptor knows the version the project pins, which the static
  // list does not, so prefer it when it agrees with the requested manager.
  return detected?.name === requested.name
    ? detected
    : resolvePackageManagerDescriptor(requested.name)
}

/**
 * Required (non-optional) peer dependencies of the modules being added that the
 * project does not already depend on, so a module such as `@pinia/nuxt` does not
 * end up installed without `pinia`.
 */
export function resolveRequiredPeerDependencies(modules: ResolvedModule[], dependencies: Set<string>): string[] {
  const peers = new Map<string, string>()
  const moduleNames = new Set(modules.map(module => module.pkgName))

  for (const module of modules) {
    for (const [name, version] of Object.entries(module.peerDependencies || {})) {
      if (dependencies.has(name) || moduleNames.has(name) || peers.has(name)) {
        continue
      }
      if (module.optionalPeerDependencies?.includes(name)) {
        continue
      }
      // Ranges that cannot be passed as part of a package spec (`*`, `>=3 <5`)
      // fall back to the bare name.
      const usable = version && version !== '*' && !WHITESPACE_RE.test(version)
      peers.set(name, usable ? `${name}@${version}` : name)
    }
  }

  return [...peers.values()]
}

/** `module`, `layers`, `modules and layers`, and so on. */
export function describeModules(modules: Array<{ isLayer?: boolean }>): string {
  const layers = modules.filter(module => module.isLayer).length
  const plain = modules.length - layers

  const parts: string[] = []
  if (plain > 0) {
    parts.push(plain > 1 ? 'modules' : 'module')
  }
  if (layers > 0) {
    parts.push(layers > 1 ? 'layers' : 'layer')
  }

  return parts.join(' and ')
}

function getDefaultNuxtConfig() {
  return `
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: []
})`
}

async function resolveModule(moduleName: string, cwd: string, modulesDB: NuxtModule[], getProjectNuxtVersion: () => Promise<string>): Promise<ModuleResolution> {
  const spec = parseModuleSpec(moduleName)

  if (!spec) {
    logger.error(`Invalid package name ${styleText('cyan', moduleName)}.`)
    return false
  }

  let { pkgName, pkgVersion } = spec
  let subpath = spec.subpath

  const bareName = subpath ? `${pkgName}/${subpath}` : pkgName
  const matchedModule = modulesDB.find(
    module =>
      module.name === moduleName
      || module.name === bareName
      || module.npm === bareName
      || module.npm === pkgName
      || module.aliases?.includes(bareName)
      || module.aliases?.includes(pkgName),
  )

  if (matchedModule?.npm) {
    // The database records the package to install, which may itself be scoped
    // differently to what the user typed (`maz-ui` -> `@maz-ui/nuxt`).
    pkgName = basePackageName(matchedModule.npm)
    subpath = matchedModule.npm.slice(pkgName.length + 1) || subpath
  }

  if (matchedModule && matchedModule.compatibility.nuxt) {
    const nuxtVersion = await getProjectNuxtVersion()

    // Check for Module Compatibility
    if (!checkNuxtCompatibility(matchedModule, nuxtVersion)) {
      logger.warn(
        `The module ${styleText('cyan', pkgName)} is not compatible with Nuxt ${styleText('cyan', nuxtVersion)} (requires ${styleText('cyan', matchedModule.compatibility.nuxt)})`,
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
              `Recommended version of ${styleText('cyan', pkgName)} for Nuxt ${styleText('cyan', nuxtVersion)} is ${styleText('cyan', _moduleVersion)} but you have requested ${styleText('cyan', pkgVersion)}.`,
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
  const pkgUrl = joinURL(meta.registry, `${pkgName}`)
  const pkgDetails = await fetchJson<any>(pkgUrl, { headers }).catch((err: unknown) => {
    logNetworkError(err, { url: pkgUrl, prefix: `Failed to fetch package details for ${styleText('cyan', pkgName)}.` })
    return null
  })
  if (!pkgDetails) {
    return false
  }

  // fully resolve the version
  if (pkgDetails['dist-tags']?.[version]) {
    version = pkgDetails['dist-tags'][version]
  }
  else {
    version = findMaxSatisfying(Object.keys(pkgDetails.versions || {}), version) || version
  }

  const pkg = pkgDetails.versions[version!] || {}

  const entry = resolveModuleEntry(pkg)
  if (!subpath && entry.subpath) {
    subpath = entry.subpath
  }

  if (entry.isLayer) {
    logger.info(`${styleText('cyan', pkgName)} is a Nuxt layer, and will be added to ${styleText('cyan', 'extends')}.`)
  }

  const pkgDependencies = Object.assign(
    pkg.dependencies || {},
    pkg.devDependencies || {},
    pkg.peerDependencies || {},
  )
  // A package exposing its module behind a `nuxt`/`module` subpath is a Nuxt
  // integration regardless of how it declares its dependency on Nuxt.
  if (
    !entry.isLayer
    && !subpath
    && !pkgDependencies.nuxt
    && !pkgDependencies['@nuxt/kit']
  ) {
    logger.warn(`It seems that ${styleText('cyan', pkgName)} is not a Nuxt module.`)
    const shouldContinue = await confirm({
      message: `Do you want to continue installing ${styleText('cyan', pkgName)} anyway?`,
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
    specifier: subpath ? `${pkgName}/${subpath}` : pkgName,
    isLayer: entry.isLayer,
    peerDependencies: pkg.peerDependencies,
    optionalPeerDependencies: Object.entries(pkg.peerDependenciesMeta || {})
      .filter(([, meta]) => (meta as { optional?: boolean } | undefined)?.optional)
      .map(([name]) => name),
  }
}
