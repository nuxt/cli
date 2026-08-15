import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { dirname, join } from 'pathe'
import { parseSync } from 'rolldown/utils'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { addNuxtConfigEntries, readNuxtConfig, removeNuxtConfigEntries } from '../../../src/utils/config'

const rolldownPath = dirname(fileURLToPath(import.meta.resolve('rolldown/package.json')))

interface Shape {
  name: string
  source: string
  modules: string[]
}

const WRAPPERS: [name: string, wrap: (object: string) => string][] = [
  ['defineNuxtConfig', object => `export default defineNuxtConfig(${object})`],
  ['plain object', object => `export default ${object}`],
  ['satisfies', object => `export default defineNuxtConfig(${object}) satisfies NuxtConfig`],
  ['as const', object => `export default defineNuxtConfig(${object}) as NuxtConfig`],
]

const ENTRIES: [name: string, entries: string[], modules: string[]][] = [
  ['no modules key', [], []],
  ['empty array', [], []],
  ['one entry', ['@nuxt/eslint'], ['@nuxt/eslint']],
  ['three entries', ['@nuxt/eslint', '@nuxt/image', '@nuxt/fonts'], ['@nuxt/eslint', '@nuxt/image', '@nuxt/fonts']],
  ['array-form entry', ['[\'@nuxt/image\', { quality: 80 }]'], ['@nuxt/image']],
  ['mixed entries', ['@nuxt/eslint', '[\'@nuxt/image\', { quality: 80 }]'], ['@nuxt/eslint', '@nuxt/image']],
]

const LAYOUTS: [name: string, render: (entries: string[], quote: string, indent: string, trailingComma: boolean) => string][] = [
  ['inline', (entries, quote, _indent, trailingComma) => `[${entries.map(entry => quoted(entry, quote)).join(', ')}${entries.length && trailingComma ? ',' : ''}]`],
  ['multi-line', (entries, quote, indent, trailingComma) => entries.length === 0
    ? '[]'
    : `[\n${entries.map(entry => `${indent}${indent}${quoted(entry, quote)}`).join(',\n')}${trailingComma ? ',' : ''}\n${indent}]`],
]

function quoted(entry: string, quote: string): string {
  return entry.startsWith('[') ? entry.replaceAll('\'', quote) : `${quote}${entry}${quote}`
}

function* shapes(): Generator<Shape> {
  for (const [wrapperName, wrap] of WRAPPERS) {
    for (const [entriesName, entries, modules] of ENTRIES) {
      for (const [layoutName, render] of LAYOUTS) {
        for (const quote of ['\'', '"']) {
          for (const indent of ['  ', '    ', '\t']) {
            for (const trailingComma of [true, false]) {
              const hasKey = entriesName !== 'no modules key'
              const body = [
                `${indent}ssr: true,`,
                hasKey ? `${indent}modules: ${render(entries, quote, indent, trailingComma)},` : '',
                `${indent}// keep me`,
                `${indent}devtools: { enabled: true },`,
              ].filter(Boolean).join('\n')
              yield {
                name: `${wrapperName} / ${entriesName} / ${layoutName} / ${quote === '\'' ? 'single' : 'double'} / ${indent === '\t' ? 'tab' : `${indent.length} spaces`} / ${trailingComma ? 'trailing comma' : 'no trailing comma'}`,
                source: `${wrap(`{\n${body}\n}`)}\n`,
                modules,
              }
            }
          }
        }
      }
    }
  }
}

/** Read the `modules` list straight from the parser, independently of the editor. */
function readModules(source: string): string[] {
  const { program, errors } = parseSync('nuxt.config.ts', source)
  if (errors.length) {
    throw new Error(`config no longer parses: ${JSON.stringify(errors[0])}`)
  }
  const exported = (program.body as any[]).find(node => node.type === 'ExportDefaultDeclaration')
  let object = exported?.declaration
  while (object && ['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(object.type)) {
    object = object.expression
  }
  if (object?.type === 'CallExpression') {
    object = object.arguments[0]
  }
  const property = (object?.properties as any[] | undefined)?.find(entry => entry.type === 'Property' && entry.key?.name === 'modules')
  if (!property) {
    return []
  }
  return (property.value.elements as any[]).map((element) => {
    const target = element?.type === 'ArrayExpression' ? element.elements[0] : element
    return target?.value as string
  })
}

const directories: string[] = []

async function createProject(parser: boolean): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-config-property-')))
  directories.push(cwd)
  if (parser) {
    await mkdir(join(cwd, 'node_modules'), { recursive: true })
    await symlink(rolldownPath, join(cwd, 'node_modules/rolldown'), 'dir')
  }
  return cwd
}

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe.each([
  ['scanner', false],
  ['parser', true],
])('config editing invariants (%s)', (engine, useParser) => {
  it('should preserve the module list through an add and a remove', async () => {
    if (!useParser) {
      vi.stubEnv('NUXT_CLI_PARSER', 'scanner')
    }
    const cwd = await createProject(useParser)
    const file = join(cwd, 'nuxt.config.ts')
    const refused: string[] = []
    let checked = 0

    for (const shape of shapes()) {
      await writeFile(file, shape.source, 'utf8')

      let config
      try {
        config = await readNuxtConfig(cwd)
        await addNuxtConfigEntries(config!, { modules: ['@nuxt/test-utils', '@nuxt/eslint'] })
      }
      catch (error) {
        refused.push(`${shape.name}: ${(error as Error).message}`)
        expect(await readFile(file, 'utf8'), shape.name).toBe(shape.source)
        continue
      }

      const added = [...new Set([...shape.modules, '@nuxt/test-utils', '@nuxt/eslint'])]
      const afterAdd = await readFile(file, 'utf8')
      expect(readModules(afterAdd), `add: ${shape.name}`).toEqual(added)
      expect(afterAdd, `add: ${shape.name}`).toContain('// keep me')
      expect(afterAdd, `add: ${shape.name}`).toContain('ssr: true')

      await removeNuxtConfigEntries((await readNuxtConfig(cwd))!, { modules: ['@nuxt/test-utils', '@nuxt/fonts'] })

      const afterRemove = await readFile(file, 'utf8')
      expect(readModules(afterRemove), `remove: ${shape.name}`).toEqual(added.filter(name => name !== '@nuxt/test-utils' && name !== '@nuxt/fonts'))
      expect(afterRemove, `remove: ${shape.name}`).toContain('devtools: { enabled: true }')
      checked++
    }

    expect(checked, `${engine} refusals: ${refused.join('\n')}`).toBeGreaterThan(0)
    expect(refused).toEqual([])
  }, 60_000)

  it('should keep CRLF endings and a nested array entry intact', async () => {
    if (!useParser) {
      vi.stubEnv('NUXT_CLI_PARSER', 'scanner')
    }
    const cwd = await createProject(useParser)
    const file = join(cwd, 'nuxt.config.ts')
    const source = 'export default defineNuxtConfig({\r\n  modules: [\r\n    [\'@nuxt/image\', { quality: 80 }],\r\n  ],\r\n})\r\n'
    await writeFile(file, source, 'utf8')

    await addNuxtConfigEntries((await readNuxtConfig(cwd))!, { modules: ['@nuxt/fonts'] })

    const after = await readFile(file, 'utf8')
    expect(after.split('\n').every(line => line === '' || line.endsWith('\r'))).toBe(true)
    expect(after).toContain('{ quality: 80 }')
    expect(readModules(after)).toEqual(['@nuxt/image', '@nuxt/fonts'])
  })
})
