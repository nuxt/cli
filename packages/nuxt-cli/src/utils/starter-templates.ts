import process from 'node:process'

import { fetchJson } from './fetch.ts'

export const hiddenTemplates = [
  'doc-driven',
  'v4',
  'v4-compat',
  'v2-bridge',
  'v3',
  'ui-vue',
  'module-devtools',
  'layer',
  'hub',
]

export interface TemplateData {
  name: string
  description: string
  defaultDir: string
  url: string
  tar: string
}

const GITHUB_HOSTS = new Set(['api.github.com', 'github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com'])

/**
 * Whether `url` is a GitHub host the `GITHUB_TOKEN` may be sent to. The listing
 * response chooses the download URLs, so the token follows the host allowlist
 * rather than the response.
 */
function isGitHubURL(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && GITHUB_HOSTS.has(parsed.hostname)
  }
  catch {
    return false
  }
}

export function fetchOptionsFor(url: string) {
  const token = process.env.GITHUB_TOKEN
  return {
    // A proxy CONNECT plus TLS handshake on a corporate link regularly costs more
    // than 3s. The template list is prefetched and has a static fallback, so a
    // slightly longer deadline only ever delays the prompt on a broken network.
    timeout: 5000,
    headers: {
      'user-agent': '@nuxt/cli',
      ...token && isGitHubURL(url) ? { authorization: `token ${token}` } : {},
    },
  }
}

export const TEMPLATES_API_URL = 'https://api.github.com/repos/nuxt/starter/contents/templates?ref=templates'

let templatesCache: Promise<Record<string, TemplateData>> | null = null

export async function getTemplates() {
  templatesCache ||= fetchTemplates()
  return templatesCache
}

export async function fetchTemplates() {
  const templates = Object.create(null) as Record<string, TemplateData>

  const files = await fetchJson<Array<{ name: string, type: string, download_url?: string }>>(
    TEMPLATES_API_URL,
    fetchOptionsFor(TEMPLATES_API_URL),
  )

  if (!Array.isArray(files)) {
    return templates
  }

  await Promise.all(files.map(async (file) => {
    if (!file?.download_url || file.type !== 'file' || typeof file.name !== 'string' || !file.name.endsWith('.json')) {
      return
    }
    const templateName = file.name.replace('.json', '')
    if (hiddenTemplates.includes(templateName) || !isGitHubURL(file.download_url)) {
      return
    }
    templates[templateName] = undefined as unknown as TemplateData
    templates[templateName] = await fetchJson<TemplateData>(file.download_url, fetchOptionsFor(file.download_url))
  }))

  return templates
}
