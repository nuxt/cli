/** generate completion data from nitropack and Nuxt starter repo */

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'

import { hiddenTemplates } from '../packages/nuxi/src/utils/starter-templates.ts'

interface PresetMeta {
  _meta?: { name: string }
}

const outputPath = new URL('../packages/nuxi/src/utils/completions-data.ts', import.meta.url)

export async function generateCompletionData() {
  const data = {
    nitroPresets: [] as string[],
    templates: {} as Record<string, string>,
    templateDefaultDirs: {} as Record<string, string>,
  }

  const nitropackPath = dirname(resolveModulePath('nitropack/package.json', { from: outputPath }))
  const presetsPath = join(nitropackPath, 'dist/presets/_all.gen.mjs')
  const { default: allPresets } = await import(pathToFileURL(presetsPath).toString()) as { default: PresetMeta[] }

  data.nitroPresets = allPresets
    .map(preset => preset._meta?.name)
    .filter((name): name is string => Boolean(name))
    .filter(name => !['base-worker', 'nitro-dev', 'nitro-prerender'].includes(name))
    .filter((name, index, array) => array.indexOf(name) === index)
    .sort()

  const response = await fetch(
    'https://api.github.com/repos/nuxt/starter/contents/templates?ref=templates',
  )

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`)
  }

  const files = await response.json() as Array<{ name: string, type: string, download_url?: string }>

  const jsonFiles = files.filter(file => file.type === 'file' && file.name.endsWith('.json'))

  for (const file of jsonFiles) {
    try {
      const templateName = file.name.replace('.json', '')
      if (hiddenTemplates.includes(templateName)) {
        continue
      }
      data.templates[templateName] = ''
      const fileResponse = await fetch(file.download_url!)
      if (fileResponse.ok) {
        const json = await fileResponse.json() as { description?: string, defaultDir?: string }
        data.templates[templateName] = json.description || ''
        if (json.defaultDir) {
          data.templateDefaultDirs[templateName] = json.defaultDir
        }
      }
    }
    catch (error) {
      // Skip if we can't fetch the file
      console.warn(`Could not fetch description for ${file.name}:`, error)
    }
  }

  const content = `/** Auto-generated file */

export const nitroPresets = ${JSON.stringify(data.nitroPresets, null, 2)} as const

export const templates = ${JSON.stringify(data.templates, null, 2)} as const

export const templateDefaultDirs = ${JSON.stringify(data.templateDefaultDirs, null, 2)} as const
`

  await writeFile(outputPath, content, 'utf-8')
}

generateCompletionData().catch((error) => {
  console.error('Failed to generate completion data:', error)
  process.exit(1)
})
