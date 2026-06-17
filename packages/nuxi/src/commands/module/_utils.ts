import type { PackageManager } from 'nypm'
import type { PackageJson } from 'pkg-types'

import { existsSync } from 'node:fs'

import { confirm, isCancel } from '@clack/prompts'
import { parseINI } from 'confbox'
import { colors } from 'consola/utils'
import { $fetch } from 'ofetch'
import { resolve } from 'pathe'
import { satisfies } from 'semver'

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

export async function fetchModules(): Promise<NuxtModule[]> {
  const { modules } = await $fetch<NuxtApiModulesResponse>(
    `https://api.nuxt.com/modules?version=all`,
  )
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

export function getRegistryFromContent(content: string, scope: string | null) {
  try {
    const npmConfig = parseINI<Record<string, string | undefined>>(content)

    if (scope) {
      const scopeKey = `${scope}:registry`
      if (npmConfig[scopeKey]) {
        return npmConfig[scopeKey].trim()
      }
    }

    if (npmConfig.registry) {
      return npmConfig.registry.trim()
    }

    return null
  }
  catch {
    return null
  }
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
