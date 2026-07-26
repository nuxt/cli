import type { PackageManager } from 'nypm'
import type { PackageJson } from 'pkg-types'

import { existsSync } from 'node:fs'

import { confirm, isCancel } from '@clack/prompts'
import { resolve } from 'pathe'
import colors from 'picocolors'
import { satisfies } from 'verkit'

import { fetchJson } from '../../utils/fetch'
import { logger } from '../../utils/logger'
import { relativeToProcess } from '../../utils/paths'
import { cwdArgs, logLevelArgs } from '../_shared'

export const categories = [
  'Analytics',
  'CMS',
  'CSS',
  'Database',
  'Date',
  'Deployment',
  'Devtools',
  'Extensions',
  'Ecommerce',
  'Fonts',
  'Images',
  'Libraries',
  'Monitoring',
  'Payment',
  'Performance',
  'Request',
  'SEO',
  'Security',
  'UI',
]

interface NuxtApiModulesResponse {
  version: string
  generatedAt: string
  stats: Stats
  maintainers: MaintainerInfo[]
  contributors: Contributor[]
  modules: NuxtModule[]
}

interface Contributor {
  id: number
  username: string
  contributions: number
  modules: string[]
}

interface Stats {
  downloads: number
  stars: number
  maintainers: number
  contributors: number
  modules: number
}

interface ModuleCompatibility {
  nuxt: string
  requires: { bridge?: boolean | 'optional' }
  versionMap: {
    [nuxtVersion: string]: string
  }
}

interface MaintainerInfo {
  name: string
  github: string
  twitter?: string
}

interface GitHubContributor {
  username: string
  name?: string
  avatar_url?: string
}

type ModuleType = 'community' | 'official' | '3rd-party'

export interface NuxtModule {
  name: string
  description: string
  repo: string
  npm: string
  icon?: string
  github: string
  website: string
  learn_more: string
  category: (typeof categories)[number]
  type: ModuleType
  maintainers: MaintainerInfo[]
  contributors?: GitHubContributor[]
  compatibility: ModuleCompatibility
  aliases?: string[]
  stats: Stats

  // Fetched in realtime API for modules.nuxt.org
  downloads?: number
  tags?: string[]
  stars?: number
  publishedAt?: number
  createdAt?: number
}

export const MODULES_API_URL = 'https://api.nuxt.com/modules?version=all'

export async function fetchModules(): Promise<NuxtModule[]> {
  const { modules } = await fetchJson<NuxtApiModulesResponse>(MODULES_API_URL)
  return modules
}

export function checkNuxtCompatibility(
  module: NuxtModule,
  nuxtVersion: string,
): boolean {
  if (!module.compatibility?.nuxt) {
    return true
  }

  return satisfies(nuxtVersion, module.compatibility.nuxt, {
    includePrerelease: true,
  })
}

// Based on https://github.com/dword-design/package-name-regex, extended with an
// optional subpath (`maz-ui/nuxt`) and an optional version in either position.
const MODULE_SPEC_RE = /^(?<name>(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)(?:@(?<earlyVersion>[^@/]+))?(?<subpath>(?:\/[^@/]+)*)(?:@(?<version>[^@]+))?$/

export interface ModuleSpec {
  /** npm package name to install, without subpath or version. */
  pkgName: string
  /** Requested version, if the user asked for one. */
  pkgVersion?: string
  /** Subpath the user asked for, without a leading slash (e.g. `nuxt`). */
  subpath?: string
}

/** Parse a user-provided module spec such as `@maz-ui/nuxt@1.2.3` or `maz-ui/nuxt`. */
export function parseModuleSpec(input: string): ModuleSpec | undefined {
  const groups = input.match(MODULE_SPEC_RE)?.groups
  if (!groups?.name) {
    return
  }

  const version = groups.version || groups.earlyVersion
  const subpath = groups.subpath?.replace(/^\//, '')

  return {
    pkgName: groups.name,
    pkgVersion: version || undefined,
    subpath: subpath || undefined,
  }
}

/** The npm package name a config entry such as `maz-ui/nuxt` belongs to. */
export function basePackageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

const NUXT_CONFIG_ENTRY_RE = /(?:^|\/)nuxt\.config\.[cm]?[jt]s$/
// Nuxt resolves module specifiers with these suffixes, in this order.
// https://github.com/nuxt/nuxt/blob/main/packages/kit/src/module/install.ts
const MODULE_SUBPATHS = ['nuxt', 'module'] as const

export interface ModuleEntry {
  /** Subpath to use in `nuxt.config`, if the module lives behind one. */
  subpath?: string
  /** The package is a Nuxt layer and belongs in `extends`, not `modules`. */
  isLayer: boolean
}

type Exports = PackageJson['exports']

function resolveExportTarget(entry: Exports): string | undefined {
  if (typeof entry === 'string') {
    return entry
  }
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const resolved = resolveExportTarget(item)
      if (resolved) {
        return resolved
      }
    }
    return
  }
  if (entry && typeof entry === 'object') {
    for (const key of ['nuxt', 'import', 'module', 'require', 'default'] as const) {
      if (key in entry) {
        const resolved = resolveExportTarget((entry as Record<string, Exports>)[key])
        if (resolved) {
          return resolved
        }
      }
    }
  }
}

/**
 * Work out how a package should be referenced from `nuxt.config`, mirroring the
 * subpath suffixes Nuxt itself tries when resolving a module specifier, so that
 * packages exposing their module at `<pkg>/nuxt` and layers whose entrypoint is a
 * `nuxt.config` file both end up in the right place.
 */
export function resolveModuleEntry(pkg: PackageJson): ModuleEntry {
  const exports = pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)
    ? pkg.exports as Record<string, Exports>
    : undefined

  // Bare condition maps (`exports: { import: '...' }`) describe the root entry.
  const hasSubpathExports = exports && Object.keys(exports).some(key => key.startsWith('.'))

  if (hasSubpathExports) {
    for (const subpath of MODULE_SUBPATHS) {
      if (exports[`./${subpath}`]) {
        return { subpath, isLayer: false }
      }
    }
  }

  const rootEntry = (hasSubpathExports ? resolveExportTarget(exports['.']) : resolveExportTarget(pkg.exports))
    ?? pkg.module
    ?? pkg.main

  // A layer's entrypoint is its `nuxt.config`. Where there is no entry at all, an
  // explicitly published `nuxt.config` is the only remaining signal (a package
  // without `main` may still be a module resolved through an implicit `index.js`).
  const isLayer = rootEntry
    ? NUXT_CONFIG_ENTRY_RE.test(rootEntry)
    : Boolean(pkg.files?.some(file => NUXT_CONFIG_ENTRY_RE.test(file)))

  return { isLayer }
}

export function getProjectDependencies(projectPkg: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(projectPkg.dependencies || {}),
    ...Object.keys(projectPkg.devDependencies || {}),
  ])
}

/**
 * Warn and prompt to continue when the project has no `nuxt` dependency.
 * Returns `false` if the user declines or cancels.
 */
export async function ensureNuxtDependency(cwd: string, projectPkg: PackageJson): Promise<boolean> {
  if (projectPkg.dependencies?.nuxt || projectPkg.devDependencies?.nuxt) {
    return true
  }

  logger.warn(`No ${colors.cyan('nuxt')} dependency detected in ${colors.cyan(relativeToProcess(cwd))}.`)

  const shouldContinue = await confirm({
    message: `Do you want to continue anyway?`,
    initialValue: false,
  })

  return !isCancel(shouldContinue) && shouldContinue === true
}

export function isPnpmWorkspace(packageManager: PackageManager | undefined, cwd: string): boolean {
  return packageManager?.name === 'pnpm' && existsSync(resolve(cwd, 'pnpm-workspace.yaml'))
}

/** Forward `cwd` and log-level args to a chained command invocation. */
export function forwardCommandArgs(args: Record<string, unknown>): string[] {
  return Object.entries(args)
    .filter(([k]) => k in cwdArgs || k in logLevelArgs)
    .map(([k, v]) => `--${k}=${v}`)
}
