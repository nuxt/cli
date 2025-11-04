/** generate completion data from nitropack and Nuxt starter repo */

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'

interface PresetMeta {
  _meta?: { name: string }
}

const outputPath = new URL('../packages/nuxi/src/utils/completions-data.ts', import.meta.url)

export async function generateCompletionData() {
  const data = { nitroPresets: [] as string[], templates: [] as string[] }

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

  const files = await response.json() as Array<{ name: string, type: string }>

  const templateEntries = files
    .filter((file) => {
      if (file.type === 'dir')
        return true
      if (file.type === 'file' && file.name.endsWith('.json') && file.name !== 'content.json') {
        return true
      }
      return false
    })
    .map(file => file.name.replace('.json', ''))

  data.templates = Array.from(new Set(templateEntries))
    .filter(name => name !== 'community')
    .sort()

  const content = `/** Auto-generated file */

export const nitroPresets = ${JSON.stringify(data.nitroPresets, null, 2)} as const

export const templates = ${JSON.stringify(data.templates, null, 2)} as const
`

  await writeFile(outputPath, content, 'utf-8')
}

generateCompletionData().catch((error) => {
  console.error('Failed to generate completion data:', error)
  process.exit(1)
})
