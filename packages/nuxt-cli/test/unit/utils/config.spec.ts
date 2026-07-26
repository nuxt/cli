import type { ConfigEntries } from '../../../src/utils/config'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { addNuxtConfigEntries, createNuxtConfig, readNuxtConfig, removeNuxtConfigEntries } from '../../../src/utils/config'

const rolldownPath = dirname(fileURLToPath(import.meta.resolve('rolldown/package.json')))

afterEach(() => {
  vi.unstubAllEnvs()
})

async function createProject(files: Record<string, string> = {}, { parser = false } = {}) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-config-')))
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(cwd, name, '..'), { recursive: true })
    await writeFile(join(cwd, name), contents, 'utf8')
  }
  if (parser) {
    await mkdir(join(cwd, 'node_modules'), { recursive: true })
    await symlink(rolldownPath, join(cwd, 'node_modules/rolldown'), 'dir')
  }
  else {
    // `rolldown` is a dev dependency of this package, so a bare import would find
    // it and the scanner would never run.
    vi.stubEnv('NUXT_CLI_PARSER', 'scanner')
  }
  return cwd
}

// The oxc parser and the fallback scanner must produce identical edits, so every
// shape below runs through both.
describe.each([
  ['scanner', { parser: false }],
  ['parser', { parser: true }],
])('nuxt.config modules (%s)', (_name, options) => {
  async function add(source: string, names: string[]) {
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)
    await addNuxtConfigEntries((await readNuxtConfig(cwd))!, { modules: names })
    return await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')
  }

  async function remove(source: string, names: string[]) {
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)
    await removeNuxtConfigEntries((await readNuxtConfig(cwd))!, { modules: names })
    return await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')
  }

  async function read(source: string) {
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)
    return (await readNuxtConfig(cwd))!.modules
  }

  async function edit(source: string, add: ConfigEntries, remove?: ConfigEntries) {
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)
    const config = (await readNuxtConfig(cwd))!
    await addNuxtConfigEntries(config, add)
    if (remove) {
      await removeNuxtConfigEntries(config, remove)
    }
    return await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')
  }

  it('should add a layer to `extends`', async () => {
    const result = await edit('export default defineNuxtConfig({\n  extends: [\'./layers/base\'],\n})\n', { extends: ['nuxt-seo-kit'] })

    expect(result).toBe('export default defineNuxtConfig({\n  extends: [\'./layers/base\', \'nuxt-seo-kit\'],\n})\n')
  })

  it('should widen a lone `extends` string into an array', async () => {
    const result = await edit('export default defineNuxtConfig({\n  extends: \'./layers/base\',\n})\n', { extends: ['nuxt-seo-kit'] })

    expect(result).toBe('export default defineNuxtConfig({\n  extends: [\'./layers/base\', \'nuxt-seo-kit\'],\n})\n')
  })

  it('should read a lone `extends` string as a single layer', async () => {
    const cwd = await createProject({ 'nuxt.config.ts': 'export default defineNuxtConfig({\n  extends: \'./layers/base\',\n})\n' }, options)

    expect((await readNuxtConfig(cwd))!.extends).toEqual(['./layers/base'])
  })

  it('should add both keys to a config that has neither', async () => {
    const result = await edit('export default defineNuxtConfig({\n  ssr: false,\n})\n', { modules: ['@nuxt/image'], extends: ['nuxt-seo-kit'] })

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\'@nuxt/image\'],\n  extends: [\'nuxt-seo-kit\'],\n  ssr: false,\n})\n')
  })

  it('should edit `modules` and `extends` in one pass', async () => {
    const source = 'export default defineNuxtConfig({\n  modules: [\n    \'@nuxt/image\',\n  ],\n  extends: [\n    \'./layers/base\',\n  ],\n})\n'

    const result = await edit(source, { modules: ['@nuxt/content'], extends: ['nuxt-seo-kit'] })

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'@nuxt/image\',\n    \'@nuxt/content\',\n  ],\n  extends: [\n    \'./layers/base\',\n    \'nuxt-seo-kit\',\n  ],\n})\n')
  })

  it('should remove from `modules` and `extends` in one pass', async () => {
    const source = 'export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\',\n  ],\n  extends: [\n    \'./layers/base\',\n    \'nuxt-seo-kit\',\n  ],\n})\n'
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)

    await removeNuxtConfigEntries((await readNuxtConfig(cwd))!, { modules: ['b'], extends: ['./layers/base'] })

    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n  extends: [\n    \'nuxt-seo-kit\',\n  ],\n})\n')
  })

  it('should leave a lone `extends` string in place when asked to remove it', async () => {
    const source = 'export default defineNuxtConfig({\n  extends: \'./layers/base\',\n})\n'
    const cwd = await createProject({ 'nuxt.config.ts': source }, options)

    await removeNuxtConfigEntries((await readNuxtConfig(cwd))!, { extends: ['./layers/base'] })

    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(source)
  })

  it('should append to a single-line array', async () => {
    const result = await add('// my config\nexport default defineNuxtConfig({\n  modules: [\'@nuxt/image\'],\n})\n', ['@nuxt/content'])

    expect(result).toBe('// my config\nexport default defineNuxtConfig({\n  modules: [\'@nuxt/image\', \'@nuxt/content\'],\n})\n')
  })

  it('should keep a trailing comment with the entry it annotates', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n    \'@nuxt/eslint\', // keep me\n  ],\n})\n', ['@nuxt/image'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'@nuxt/eslint\', // keep me\n    \'@nuxt/image\',\n  ],\n})\n')
  })

  it('should add a `modules` array to a config without one', async () => {
    const result = await add('export default defineNuxtConfig({\n  devtools: { enabled: true },\n})\n', ['@nuxt/image'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\'@nuxt/image\'],\n  devtools: { enabled: true },\n})\n')
  })

  it('should add a `modules` array to an empty config', async () => {
    const result = await add('export default defineNuxtConfig({})\n', ['@nuxt/image'])

    expect(result).toBe('export default defineNuxtConfig({ modules: [\'@nuxt/image\'] })\n')
  })

  it('should fill an empty array', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [],\n})\n', ['@nuxt/image'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\'@nuxt/image\'],\n})\n')
  })

  it('should append several entries in the order given', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n})\n', ['x', 'y'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'x\',\n    \'y\',\n  ],\n})\n')
  })

  it('should match the quote style already used in the file', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: ["a"],\n  app: { head: { title: "x" } },\n})\n', ['@nuxt/image'])

    expect(result).toContain('modules: ["a", "@nuxt/image"]')
  })

  it('should edit a plain object export', async () => {
    const result = await add('// leading\nexport default {\n  /* block */\n  modules: [\'a\'],\n}\n', ['@nuxt/content'])

    expect(result).toBe('// leading\nexport default {\n  /* block */\n  modules: [\'a\', \'@nuxt/content\'],\n}\n')
  })

  it('should ignore modules that are already listed', async () => {
    const source = 'export default defineNuxtConfig({\n  modules: [\'a\'],\n})\n'

    expect(await add(source, ['a'])).toBe(source)
  })

  it('should leave the file untouched when adding nothing', async () => {
    const source = 'export default defineNuxtConfig({\n  modules: [\'a\'],   // odd   spacing\n})\n'

    expect(await add(source, [])).toBe(source)
  })

  it('should read names in source order', async () => {
    expect(await read('export default defineNuxtConfig({\n  modules: [\'a\', \'b\'],\n})\n')).toEqual(['a', 'b'])
  })

  it('should read names from array-form entries', async () => {
    const modules = await read('export default defineNuxtConfig({\n  modules: [\n    [\'@nuxt/image\', { quality: 80 }],\n    \'@nuxt/eslint\',\n  ],\n})\n')

    expect(modules).toEqual(['@nuxt/image', '@nuxt/eslint'])
  })

  it('should omit entries whose name is not a plain string', async () => {
    const modules = await read('import mod from \'./mod\'\n\nexport default defineNuxtConfig({\n  modules: [mod, \'@nuxt/eslint\'],\n})\n')

    expect(modules).toEqual(['@nuxt/eslint'])
  })

  it('should report no modules when the config has no `modules` key', async () => {
    expect(await read('export default defineNuxtConfig({ ssr: false })\n')).toEqual([])
  })

  it('should remove an entry and its trailing comment', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\', // gone with b\n    \'c\',\n  ],\n})\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'c\',\n  ],\n})\n')
  })

  it('should not leave a stray separator when removing from a single-line array', async () => {
    const source = 'export default defineNuxtConfig({ modules: [\'a\', \'b\'] })\n'

    expect(await remove(source, ['a'])).toBe('export default defineNuxtConfig({ modules: [\'b\'] })\n')
    expect(await remove(source, ['b'])).toBe('export default defineNuxtConfig({ modules: [\'a\'] })\n')
  })

  it('should collapse the array when every entry is removed', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n})\n', ['a'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [],\n})\n')
  })

  it('should remove several entries at once', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\',\n    \'c\',\n  ],\n})\n', ['a', 'c'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'b\',\n  ],\n})\n')
  })

  it('should keep array-form entries that were not named', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    [\'a\', { q: 1 }],\n    \'b\',\n  ],\n})\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    [\'a\', { q: 1 }],\n  ],\n})\n')
  })

  it('should ignore modules that are not listed', async () => {
    const source = 'export default defineNuxtConfig({\n  modules: [\'a\'],\n})\n'

    expect(await remove(source, ['b'])).toBe(source)
  })

  it('should respect tab indentation', async () => {
    const result = await add('export default defineNuxtConfig({\n\tmodules: [\n\t\t\'a\',\n\t],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n\tmodules: [\n\t\t\'a\',\n\t\t\'zz\',\n\t],\n})\n')
  })

  it('should respect a four-space indent', async () => {
    const result = await add('export default defineNuxtConfig({\n    modules: [\n        \'a\',\n    ],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n    modules: [\n        \'a\',\n        \'zz\',\n    ],\n})\n')
  })

  it('should supply the missing separator for an array without a trailing comma', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n    \'a\'\n  ],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'zz\'\n  ],\n})\n')
  })

  it('should not introduce a trailing comma the file does not use', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\'\n  ],\n})\n', ['y', 'z'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\',\n    \'y\',\n    \'z\'\n  ],\n})\n')
  })

  it('should take the quote style from an existing entry rather than the whole file', async () => {
    const result = await add('export default defineNuxtConfig({\n  app: { head: { title: "x", meta: "y", link: "z" } },\n  modules: [\n    \'a\',\n  ],\n})\n', ['zz'])

    expect(result).toContain('\'a\',\n    \'zz\',')
  })

  it('should ignore apostrophes in comments when choosing a quote style', async () => {
    const result = await add('// don\'t do this, it isn\'t good, wouldn\'t you say\nexport default defineNuxtConfig({\n  modules: [\n    "a",\n  ],\n})\n', ['zz'])

    expect(result).toContain('"a",\n    "zz",')
  })

  it('should fall back to the file\'s quote style for an empty array', async () => {
    const result = await add('export default defineNuxtConfig({\n  srcDir: "app",\n  modules: [],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  srcDir: "app",\n  modules: ["zz"],\n})\n')
  })

  it('should quote a new `modules` key when the other keys are quoted', async () => {
    const result = await add('export default defineNuxtConfig({\n  "srcDir": "app",\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  "modules": ["zz"],\n  "srcDir": "app",\n})\n')
  })

  it('should not double the separator for an inline array with a trailing comma', async () => {
    const result = await add('export default defineNuxtConfig({ modules: [\'a\',] })\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({ modules: [\'a\', \'zz\'] })\n')
  })

  it('should indent into an empty multi-line array', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n  ],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'zz\',\n  ],\n})\n')
  })

  it('should stay inside an array whose bracket closes on the last entry\'s line', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\'a\',\n    \'b\'],\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\'a\',\n    \'b\', \'zz\'],\n})\n')
  })

  it('should keep CRLF line endings', async () => {
    const result = await add('export default defineNuxtConfig({\r\n  modules: [\r\n    \'a\',\r\n  ],\r\n})\r\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\r\n  modules: [\r\n    \'a\',\r\n    \'zz\',\r\n  ],\r\n})\r\n')
  })

  it('should match the surrounding indent when adding a `modules` key', async () => {
    const result = await add('export default defineNuxtConfig({\n\tssr: false,\n})\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n\tmodules: [\'zz\'],\n\tssr: false,\n})\n')
  })

  it('should edit a config wrapped in a type assertion', async () => {
    const result = await add('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n}) as any\n', ['zz'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'zz\',\n  ],\n}) as any\n')
  })

  it('should not leave a trailing comma behind when the file does not use them', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\'\n  ],\n})\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\'\n  ],\n})\n')
  })

  it('should remove an inline entry followed by a trailing comma', async () => {
    const result = await remove('export default defineNuxtConfig({ modules: [\'a\', \'b\',] })\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({ modules: [\'a\'] })\n')
  })

  it('should not leave trailing whitespace when entries share a line', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\', \'b\',\n  ],\n})\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n})\n')
  })

  it('should keep CRLF line endings when removing', async () => {
    const result = await remove('export default defineNuxtConfig({\r\n  modules: [\r\n    \'a\',\r\n    \'b\',\r\n  ],\r\n})\r\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\r\n  modules: [\r\n    \'a\',\r\n  ],\r\n})\r\n')
  })

  it('should keep the trailing comma when the file does use them', async () => {
    const result = await remove('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\',\n  ],\n})\n', ['b'])

    expect(result).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n})\n')
  })

  it('should throw when `modules` is not an array', async () => {
    const cwd = await createProject({ 'nuxt.config.ts': 'export default defineNuxtConfig({ modules: {} })\n' }, options)

    await expect(readNuxtConfig(cwd)).rejects.toThrow('The `modules` entry in the config file is not an array.')
  })

  it('should throw when there is no default export', async () => {
    const cwd = await createProject({ 'nuxt.config.ts': 'export const foo = 1\n' }, options)

    await expect(readNuxtConfig(cwd)).rejects.toThrow('Default export is missing in the config file!')
  })
})

describe('readNuxtConfig', () => {
  it('should resolve a config inside `.config`', async () => {
    const cwd = await createProject({ '.config/nuxt.ts': 'export default defineNuxtConfig({})\n' })

    const config = await readNuxtConfig(cwd)

    expect(config?.file).toBe(join(cwd, '.config/nuxt.ts'))
  })

  it('should return `undefined` when there is no config file', async () => {
    const cwd = await createProject()

    await expect(readNuxtConfig(cwd)).resolves.toBeUndefined()
  })

  it('should throw for unsupported extensions', async () => {
    const cwd = await createProject({ 'nuxt.config.json': '{}' })

    await expect(readNuxtConfig(cwd)).rejects.toThrow('Unsupported config file extension: .json')
  })
})

describe('createNuxtConfig', () => {
  it('should write the config and report the modules it already lists', async () => {
    const cwd = await createProject()

    const config = await createNuxtConfig(cwd, 'export default defineNuxtConfig({\n  modules: [\'a\'],\n})\n')

    expect(config.file).toBe(join(cwd, 'nuxt.config.ts'))
    expect(config.modules).toEqual(['a'])
    expect(await readFile(config.file, 'utf8')).toContain('modules')
  })

  it('should produce a config that can then be added to', async () => {
    const cwd = await createProject()

    const config = await createNuxtConfig(cwd, 'export default defineNuxtConfig({})\n')
    await addNuxtConfigEntries(config, { modules: ['@nuxt/image'] })

    expect(await readFile(config.file, 'utf8')).toBe('export default defineNuxtConfig({ modules: [\'@nuxt/image\'] })\n')
  })
})

describe('unrecognised parsers', () => {
  /**
   * A parser whose AST is not ESTree-shaped must not be interpreted: an
   * unrecognised `modules` property looks like an absent one, which would add a
   * second `modules` key and shadow the real list.
   */
  async function createProjectWithParser(parser: string) {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-parser-')))
    // The fake parser has to be found before the real `rolldown` a bare import
    // would reach, so it is planted in the project rather than resolved from self.
    await writeFile(join(cwd, 'nuxt.config.ts'), 'export default defineNuxtConfig({\n  modules: [\n    \'a\',\n  ],\n})\n', 'utf8')
    const dir = join(cwd, 'node_modules/oxc-parser')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), '{"name":"oxc-parser","version":"0.0.0","type":"module","main":"index.mjs"}', 'utf8')
    await writeFile(join(dir, 'index.mjs'), parser, 'utf8')
    return cwd
  }

  it('should fall back to scanning for a Babel-shaped AST', async () => {
    const cwd = await createProjectWithParser(`export function parseSync(filename, source) {
      return { errors: [], program: { type: 'Program', body: [{
        type: 'ExportDefaultDeclaration',
        declaration: { type: 'CallExpression', start: 0, end: source.length, arguments: [{
          type: 'ObjectExpression', start: 32, end: source.length - 3,
          properties: [{ type: 'ObjectProperty', start: 36, key: { name: 'modules' }, value: { type: 'ArrayExpression', start: 45, end: 60, elements: [] } }],
        }] },
      }] } }
    }`)

    const config = await readNuxtConfig(cwd)
    await addNuxtConfigEntries(config!, { modules: ['b'] })

    expect(config!.modules).toEqual(['a'])
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe('export default defineNuxtConfig({\n  modules: [\n    \'a\',\n    \'b\',\n  ],\n})\n')
  })

  it('should fall back to scanning when the program is not an ESTree body', async () => {
    const cwd = await createProjectWithParser('export function parseSync() { return { errors: [], program: \'{"body":[]}\' } }')

    const config = await readNuxtConfig(cwd)

    expect(config!.modules).toEqual(['a'])
  })

  it('should fall back to scanning when the parser throws', async () => {
    const cwd = await createProjectWithParser('export function parseSync() { throw new Error(\'boom\') }')

    const config = await readNuxtConfig(cwd)

    expect(config!.modules).toEqual(['a'])
  })

  it('should fall back to scanning when the parser reports errors', async () => {
    const cwd = await createProjectWithParser('export function parseSync() { return { errors: [{ message: \'nope\' }], program: { body: [] } } }')

    const config = await readNuxtConfig(cwd)

    expect(config!.modules).toEqual(['a'])
  })
})

describe('parser resolution', () => {
  /** A spread property the scanner cannot read, so it reports no modules at all. */
  const SPREAD_CONFIG = 'export default defineNuxtConfig({\n  ...base,\n  modules: [\'a\'],\n})\n'

  /**
   * Names its single module `sentinel` rather than `a`, so a result of `['a']`
   * means some other parser (or the scanner) answered instead of this one.
   */
  const SENTINEL_PARSER = `export function parseSync(filename, source) {
    const start = source.indexOf("'a'")
    return { errors: [], program: { type: 'Program', body: [{
      type: 'ExportDefaultDeclaration',
      declaration: { type: 'CallExpression', arguments: [{
        type: 'ObjectExpression', start: source.indexOf('{'),
        properties: [{ type: 'Property', start: source.indexOf('modules'), key: { name: 'modules' }, value: {
          type: 'ArrayExpression', start: source.indexOf('['), end: source.indexOf(']') + 1,
          elements: [{ type: 'Literal', start, end: start + 3, value: 'sentinel' }],
        } }],
      }] },
    }] } }
  }`

  async function createProject(source: string) {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-resolve-')))
    await writeFile(join(cwd, 'nuxt.config.ts'), source, 'utf8')
    return cwd
  }

  async function writePackage(dir: string, name: string, contents: string) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), `{"name":"${name}","version":"0.0.0","type":"module","main":"index.mjs"}`, 'utf8')
    await writeFile(join(dir, 'index.mjs'), contents, 'utf8')
  }

  it('should use a parser installed alongside the project`s `nuxt`', async () => {
    const cwd = await createProject('export default defineNuxtConfig({\n  modules: [\'a\'],\n})\n')
    await writePackage(join(cwd, 'node_modules/nuxt'), 'nuxt', 'export default {}')
    await writePackage(join(cwd, 'node_modules/nuxt/node_modules/oxc-parser'), 'oxc-parser', SENTINEL_PARSER)

    expect((await readNuxtConfig(cwd))!.modules).toEqual(['sentinel'])
  })

  it('should use a parser reachable from itself when the project exposes none', async () => {
    const cwd = await createProject(SPREAD_CONFIG)

    expect((await readNuxtConfig(cwd))!.modules).toEqual(['a'])
  })

  it('should scan instead when `NUXT_CLI_PARSER` is set to `scanner`', async () => {
    vi.stubEnv('NUXT_CLI_PARSER', 'scanner')
    const cwd = await createProject(SPREAD_CONFIG)

    expect((await readNuxtConfig(cwd))!.modules).toEqual([])
  })
})
