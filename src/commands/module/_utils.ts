import { $fetch } from 'ofetch'
import { satisfies, coerce } from 'semver'
import { tryRequireModule } from '../../utils/cjs'
import { readPackageJson } from '../../utils/packageJson'

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

export interface NuxtApiModulesResponse {
  version: string
  generatedAt: string
  stats: Stats
  maintainers: MaintainerInfo[]
  contributors: Contributor[]
  modules: NuxtModule[]
}

export interface Contributor {
  id: number
  username: string
  contributions: number
  modules: string[]
}

export interface Stats {
  downloads: number
  stars: number
  maintainers: number
  contributors: number
  modules: number
}

export interface ModuleCompatibility {
  nuxt: string
  requires: { bridge?: boolean | 'optional' }
  versionMap: {
    [nuxtVersion: string]: string
  }
}

export interface MaintainerInfo {
  name: string
  github: string
  twitter?: string
}

export interface GithubContributor {
  username: string
  name?: string
  avatar_url?: string
}

export type CompatibilityStatus = 'working' | 'wip' | 'unknown' | 'not-working'
export type ModuleType = 'community' | 'official' | '3rd-party'

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
  contributors?: GithubContributor[]
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

export async function getNuxtVersion(cwd: string) {
  const nuxtPkg = tryRequireModule('nuxt/package.json', cwd)
  if (nuxtPkg) {
    return nuxtPkg.version
  }
  const pkg = await readPackageJson(cwd)
  const pkgDep = pkg?.dependencies?.['nuxt'] || pkg?.devDependencies?.['nuxt']
  return (pkgDep && coerce(pkgDep)?.version) || '3.0.0'
}
