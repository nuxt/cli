import process from 'node:process'
import { $fetch } from 'ofetch'

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

const fetchOptions = {
  timeout: 3000,
  responseType: 'json',
  headers: {
    'user-agent': '@nuxt/cli',
    ...process.env.GITHUB_TOKEN ? { authorization: `token ${process.env.GITHUB_TOKEN}` } : {},
  },
} as const

let templatesCache: Promise<Record<string, TemplateData>> | null = null

export async function getTemplates() {
  templatesCache ||= fetchTemplates()
  return templatesCache
}

export async function fetchTemplates() {
  const templates = {} as Record<string, TemplateData>

  const files = await $fetch<Array<{ name: string, type: string, download_url?: string }>>(
    'https://api.github.com/repos/nuxt/starter/contents/templates?ref=templates',
    fetchOptions,
  )

  await Promise.all(files.map(async (file) => {
    if (!file.download_url || file.type !== 'file' || !file.name.endsWith('.json')) {
      return
    }
    const templateName = file.name.replace('.json', '')
    if (hiddenTemplates.includes(templateName)) {
      return
    }
    templates[templateName] = undefined as unknown as TemplateData
    templates[templateName] = await $fetch(file.download_url, fetchOptions)
  }))

  return templates
}
