import { $fetch } from 'ofetch'

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

export interface ModuleCompatibility {
  nuxt: string
  requires: { bridge?: boolean | 'optional' }
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

  // Fetched in realtime API for modules.nuxt.org
  downloads?: number
  tags?: string[]
  stars?: number
  publishedAt?: number
  createdAt?: number
}

export async function fetchModules(): Promise<NuxtModule[]> {
  const data = await $fetch<NuxtModule[]>(
    'https://unpkg.com/@nuxt/modules@0.6.0-b3a910/modules.json'
  )
  return data
}
