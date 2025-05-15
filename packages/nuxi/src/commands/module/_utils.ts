import { parseINI } from 'confbox'
import { $fetch } from 'ofetch'
import { readPackageJSON } from 'pkg-types'
import { coerce, satisfies } from 'semver'

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

export async function getNuxtVersion(cwd: string) {
  const nuxtPkg = await readPackageJSON('nuxt', { url: cwd }).catch(() => null)
  if (nuxtPkg) {
    return nuxtPkg.version!
  }
  const pkg = await readPackageJSON(cwd)
  const pkgDep = pkg?.dependencies?.nuxt || pkg?.devDependencies?.nuxt
  return (pkgDep && coerce(pkgDep)?.version) || '3.0.0'
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
