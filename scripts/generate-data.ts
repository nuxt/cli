/** generate completion data from nitropack and Nuxt starter repo */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'

import { fetchTemplates } from '../packages/nuxi/src/utils/starter-templates.ts'

interface PresetMeta {
  _meta?: { name: string }
}

const dataDir = new URL('../packages/nuxi/src/data/', import.meta.url)

export async function generateCompletionData() {
  const [nitroPresets, templates] = await Promise.all([
    getNitroPresets(),
    fetchTemplates(),
  ])

  await mkdir(dataDir, { recursive: true })
  await writeFile(
    new URL('nitro-presets.ts', dataDir),
    `export const nitroPresets = ${JSON.stringify(nitroPresets, null, 2)} as const`,
  )
  await writeFile(
    new URL('templates.ts', dataDir),
    `export const templates = ${JSON.stringify(templates, null, 2)} as const`,
  )
}

async function getNitroPresets() {
  const nitropackPath = dirname(resolveModulePath('nitropack/package.json', { from: dataDir }))
  const presetsPath = join(nitropackPath, 'dist/presets/_all.gen.mjs')
  const { default: allPresets } = await import(pathToFileURL(presetsPath).toString()) as { default: PresetMeta[] }

  return allPresets
    .map(preset => preset._meta?.name)
    .filter((name): name is string => Boolean(name))
    .filter(name => !['base-worker', 'nitro-dev', 'nitro-prerender'].includes(name))
    .filter((name, index, array) => array.indexOf(name) === index)
    .sort()
}

generateCompletionData().catch((error) => {
  console.error('Failed to generate completion data:', error)
  process.exit(1)
})
