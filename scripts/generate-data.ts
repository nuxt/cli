/** generate completion data from nitropack and Nuxt starter repo */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'
import { isCI } from 'std-env'

import { fetchTemplates } from '../packages/nuxt-cli/src/utils/starter-templates.ts'

interface PresetMeta {
  _meta?: { name: string }
}

const dataDir = new URL('../packages/nuxt-cli/src/data/', import.meta.url)

const templatesFile = new URL('templates.ts', dataDir)

export async function generateCompletionData() {
  const [nitroPresets, templates] = await Promise.all([
    getNitroPresets(),
    fetchTemplates().catch(keepExistingTemplates),
  ])

  await mkdir(dataDir, { recursive: true })
  await writeFile(
    new URL('nitro-presets.ts', dataDir),
    `export const nitroPresets = ${JSON.stringify(nitroPresets, null, 2)} as const`,
  )
  if (templates) {
    await writeFile(
      templatesFile,
      `export const templates = ${JSON.stringify(templates, null, 2)} as const`,
    )
  }
}

function keepExistingTemplates(error: unknown): undefined {
  if (isCI || !existsSync(templatesFile)) {
    throw error
  }
  console.warn(`Could not fetch starter templates, keeping the ones already generated: ${error}`)
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
