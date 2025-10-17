/** generate completion data from nitropack and Nuxt starter repo */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
// @ts-expect-error: internal nitropack file
import allPresets from '../node_modules/nitropack/dist/presets/_all.gen.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PresetMeta {
    _meta?: { name: string }
}

async function generateCompletionData() {
    const data: {
        nitroPresets: string[]
        templates: string[]
    } = {
        nitroPresets: [],
        templates: [],
    }

    data.nitroPresets = (allPresets as PresetMeta[])
        .map(preset => preset._meta?.name)
        .filter((name): name is string => Boolean(name))
        .filter(name => !['base-worker', 'nitro-dev', 'nitro-prerender'].includes(name))
        .filter((name, index, array) => array.indexOf(name) === index)
        .sort()

    const response = await fetch(
        'https://api.github.com/repos/nuxt/starter/contents/templates?ref=templates'
    )

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`)
    }

    const files = await response.json() as Array<{ name: string; type: string }>

    const templateEntries = files
        .filter(file => {
            if (file.type === 'dir') return true
            if (file.type === 'file' && file.name.endsWith('.json') && file.name !== 'content.json') {
                return true
            }
            return false
        })
        .map(file => file.name.replace('.json', ''))

    data.templates = Array.from(new Set(templateEntries))
        .filter(name => name !== 'community')
        .sort()

    const outputPath = resolve(__dirname, '../src/completions-data.ts')
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

