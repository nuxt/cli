import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import fc from 'fast-check'
import { join } from 'pathe'
import { parseSync } from 'rolldown/utils'
import { beforeAll, describe, expect, it } from 'vitest'

import { addNuxtConfigEntries, readNuxtConfig, removeNuxtConfigEntries } from '../../../src/utils/config'
import { locateConfig } from '../../../src/utils/config-parse'

/**
 * Generated configs are read and edited by both the oxc parser and the fallback
 * scanner, which must agree on every shape either of them claims to support.
 */

interface Engine {
  name: string
  cwd: string
}

const engines: Engine[] = [
  { name: 'scanner', cwd: '' },
  { name: 'parser', cwd: '' },
]

beforeAll(async () => {
  for (const engine of engines) {
    engine.cwd = await realpath(await mkdtemp(join(tmpdir(), `nuxi-fuzz-${engine.name}-`)))
  }

  // `locateConfig` caches the parser it resolved per directory, so each engine is
  // pinned once here rather than by toggling the environment mid-property.
  const override = process.env.NUXT_CLI_PARSER
  try {
    process.env.NUXT_CLI_PARSER = 'scanner'
    await locateConfig('export default {}\n', 'nuxt.config.ts', engines[0]!.cwd)
    delete process.env.NUXT_CLI_PARSER
    await locateConfig('export default defineNuxtConfig({ modules: [\'a\'] })\n', 'nuxt.config.ts', engines[1]!.cwd)
  }
  finally {
    if (override === undefined) {
      delete process.env.NUXT_CLI_PARSER
    }
    else {
      process.env.NUXT_CLI_PARSER = override
    }
  }
})

/** Raised locally to fish for new counterexamples: `NUXT_CLI_FUZZ_RUNS=5000 vitest`. */
const RUNS = Number(process.env.NUXT_CLI_FUZZ_RUNS) || 200
const TIMEOUT = 120_000

const NAME_RE = /^[a-z]/

const name = fc.stringMatching(/^[a-z][\w-]{0,8}$/).filter(value => NAME_RE.test(value))

const specifier = fc.oneof(
  name,
  fc.tuple(name, name).map(([scope, pkg]) => `@${scope}/${pkg}`),
  name.map(value => `./layers/${value}`),
)

interface Entry {
  /** Source text of the array element. */
  text: string
  /** Name the CLI should read from it, or `null` when it is not a plain string. */
  name: string | null
  /** Whether the entry carries a trailing comment, when the layout allows one. */
  comment?: boolean
}

function entryArbitrary(quote: string) {
  return fc.record({
    entry: fc.oneof(
      { weight: 6, arbitrary: specifier.map(value => ({ text: `${quote}${value}${quote}`, name: value })) },
      { weight: 2, arbitrary: specifier.map(value => ({ text: `[${quote}${value}${quote}, { quality: 80 }]`, name: value })) },
      { weight: 1, arbitrary: fc.constant({ text: 'noop', name: null }) },
      { weight: 1, arbitrary: fc.constant({ text: '[noop, { a: 1 }]', name: null }) },
    ) as fc.Arbitrary<Entry>,
    comment: fc.boolean(),
  }).map(({ entry, comment }) => ({ ...entry, comment }))
}

type Layout = 'inline' | 'inline-trailing' | 'lines' | 'lines-no-trailing' | 'empty-inline' | 'empty-lines'

const NOISE_VALUES = [
  'false',
  '{ enabled: true }',
  '"a, b"',
  '\'[not, an, array]\'',
  '[1, 2, 3]',
  '{ nested: { deep: [\'x\'] } }',
  '() => ({ a: 1 })',
  '{ \'key with }\': 1 }',
]

const NOISE_KEYS = ['ssr', 'srcDir', 'devtools', 'app', 'vite', 'future', 'experimental']

interface Shape {
  source: string
  modules: string[]
  extends: string[]
}

function renderArray(entries: Entry[], layout: Layout, indent: string, eol: string): string {
  if (!entries.length || layout === 'empty-inline') {
    return '[]'
  }
  if (layout === 'empty-lines') {
    return `[${eol}${indent}]`
  }
  const texts = entries.map(entry => entry.text)
  if (layout === 'inline') {
    return `[${texts.join(', ')}]`
  }
  if (layout === 'inline-trailing') {
    return `[${texts.join(', ')},]`
  }
  const inner = `${indent}${indent}`
  const comma = layout === 'lines' ? ',' : ''
  const lines = texts.map((text, index) => {
    const separator = index < texts.length - 1 ? ',' : comma
    // A comment on the last entry is where a naive insertion point would land.
    const comment = index === texts.length - 1 && entries[index]!.comment ? ' // keep me' : ''
    return `${inner}${text}${separator}${comment}`
  })
  return `[${eol}${lines.join(eol)}${eol}${indent}]`
}

const shape: fc.Arbitrary<Shape> = fc.record({
  indent: fc.constantFrom('  ', '    ', '\t'),
  eol: fc.constantFrom('\n', '\r\n'),
  quote: fc.constantFrom('\'', '"'),
  wrapper: fc.constantFrom<'define' | 'plain' | 'assert' | 'satisfies'>('define', 'plain', 'assert', 'satisfies'),
  prelude: fc.constantFrom('', '// a config\n', '/* block */\n', '// don\'t worry, it isn\'t broken\n'),
  layout: fc.constantFrom<Layout>('inline', 'inline-trailing', 'lines', 'lines-no-trailing', 'empty-inline', 'empty-lines'),
  quotedKeys: fc.boolean(),
  singleExtends: fc.boolean(),
  hasModules: fc.boolean(),
  hasExtends: fc.boolean(),
  noise: fc.uniqueArray(fc.tuple(fc.constantFrom(...NOISE_KEYS), fc.constantFrom(...NOISE_VALUES)), { maxLength: 3, selector: pair => pair[0] }),
  noiseFirst: fc.boolean(),
  trailingComment: fc.boolean(),
}).chain(options => fc.record({
  moduleEntries: fc.array(entryArbitrary(options.quote), { maxLength: 4 }),
  extendsEntries: fc.array(entryArbitrary(options.quote), { maxLength: 3 }),
}).map(({ moduleEntries, extendsEntries }) => {
  const { indent, eol, quote, wrapper, prelude, layout, quotedKeys, singleExtends, hasModules, hasExtends, noise, noiseFirst, trailingComment } = options

  const key = (value: string) => quotedKeys ? `${quote}${value}${quote}` : value
  const properties: Array<{ text: string, comment?: boolean }> = []

  const noiseProperties = noise.map(([noiseKey, value]) => ({ text: `${key(noiseKey)}: ${value}` }))
  if (noiseFirst) {
    properties.push(...noiseProperties)
  }

  const modules = hasModules ? dedupe(moduleEntries) : []
  if (hasModules) {
    properties.push({ text: `${key('modules')}: ${renderArray(modules, layout, indent, eol)}`, comment: trailingComment })
  }

  const single = singleExtends && extendsEntries.some(entry => entry.name !== null)
  const layers = hasExtends
    ? single
      ? [extendsEntries.find(entry => entry.name !== null)!]
      : dedupe(extendsEntries)
    : []
  if (hasExtends) {
    const value = single ? layers[0]!.text : renderArray(layers, layout, indent, eol)
    properties.push({ text: `${key('extends')}: ${value}` })
  }

  if (!noiseFirst) {
    properties.push(...noiseProperties)
  }

  const body = properties.length
    ? `{${eol}${properties.map(property => `${indent}${property.text},${property.comment ? ' // a comment' : ''}`).join(eol)}${eol}}`
    : '{}'

  const expression = wrapper === 'plain'
    ? body
    : wrapper === 'define'
      ? `defineNuxtConfig(${body})`
      : wrapper === 'assert'
        ? `defineNuxtConfig(${body}) as any`
        : `defineNuxtConfig(${body}) satisfies Record<string, unknown>`

  const needsNoop = [...modules, ...layers].some(entry => entry.text.includes('noop'))
  const header = (needsNoop ? 'const noop = () => {}\n' : '') + prelude

  const listed = layout === 'empty-inline' || layout === 'empty-lines'

  return {
    source: `${header}export default ${expression}${eol}`,
    modules: listed ? [] : names(modules),
    extends: listed && !single ? [] : names(layers),
  }
}))

function dedupe(entries: Entry[]): Entry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (entry.name === null) {
      return true
    }
    if (seen.has(entry.name)) {
      return false
    }
    seen.add(entry.name)
    return true
  })
}

function names(entries: Entry[]): string[] {
  return entries.map(entry => entry.name).filter((value): value is string => value !== null)
}

async function write(engine: Engine, source: string) {
  await writeFile(join(engine.cwd, 'nuxt.config.ts'), source, 'utf8')
}

async function read(engine: Engine) {
  return await readFile(join(engine.cwd, 'nuxt.config.ts'), 'utf8')
}

function isParseable(source: string): boolean {
  return parseSync('nuxt.config.ts', source).errors.length === 0
}

function describeShape(shape: Shape, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ...shape, ...extra }, null, 2)
}

describe('config editing invariants', () => {
  it('should generate configs that parse', () => {
    fc.assert(fc.property(shape, (generated) => {
      expect(isParseable(generated.source), generated.source).toBe(true)
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should read the same names with the parser and the scanner', async () => {
    await fc.assert(fc.asyncProperty(shape, async (generated) => {
      for (const engine of engines) {
        await write(engine, generated.source)
        const config = await readNuxtConfig(engine.cwd)

        expect(config, describeShape(generated)).toBeDefined()
        expect({ engine: engine.name, modules: config!.modules, extends: config!.extends }, describeShape(generated)).toEqual({
          engine: engine.name,
          modules: generated.modules,
          extends: generated.extends,
        })
      }
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should produce the same edit with the parser and the scanner', async () => {
    await fc.assert(fc.asyncProperty(shape, fc.array(specifier, { minLength: 1, maxLength: 3 }), async (generated, added) => {
      const entries = { modules: added, extends: added }
      const results: string[] = []

      for (const engine of engines) {
        await write(engine, generated.source)
        await addNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, entries)
        results.push(await read(engine))
      }

      expect(results[1], describeShape(generated, { added })).toBe(results[0])
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should keep the config parseable and list every added entry', async () => {
    await fc.assert(fc.asyncProperty(shape, fc.uniqueArray(specifier, { minLength: 1, maxLength: 3 }), async (generated, added) => {
      for (const engine of engines) {
        await write(engine, generated.source)
        await addNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: added, extends: added })

        const source = await read(engine)
        const context = describeShape(generated, { added, engine: engine.name, result: source })

        expect(isParseable(source), context).toBe(true)

        const config = (await readNuxtConfig(engine.cwd))!
        expect(config.modules, context).toEqual([...generated.modules, ...added.filter(name => !generated.modules.includes(name))])
        expect(config.extends, context).toEqual([...generated.extends, ...added.filter(name => !generated.extends.includes(name))])
      }
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should leave the config untouched when every entry is already listed', async () => {
    await fc.assert(fc.asyncProperty(shape, fc.uniqueArray(specifier, { minLength: 1, maxLength: 3 }), async (generated, added) => {
      for (const engine of engines) {
        await write(engine, generated.source)
        await addNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: added, extends: added })
        const once = await read(engine)

        await addNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: added, extends: added })

        expect(await read(engine), describeShape(generated, { added, engine: engine.name })).toBe(once)
      }
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should undo an addition when the same entries are removed', async () => {
    await fc.assert(fc.asyncProperty(shape, fc.uniqueArray(specifier, { minLength: 1, maxLength: 3 }), async (generated, added) => {
      const fresh = added.filter(name => !generated.modules.includes(name) && !generated.extends.includes(name))
      fc.pre(fresh.length > 0)

      for (const engine of engines) {
        await write(engine, generated.source)
        await addNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: fresh, extends: fresh })
        await removeNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: fresh, extends: fresh })

        const source = await read(engine)
        const context = describeShape(generated, { fresh, engine: engine.name, result: source })

        expect(isParseable(source), context).toBe(true)

        const config = (await readNuxtConfig(engine.cwd))!
        expect(config.modules, context).toEqual(generated.modules)
        // A lone `extends` string is widened into an array by the addition, so the
        // names survive a round trip even though the source shape does not.
        expect(config.extends, context).toEqual(generated.extends)
      }
    }), { numRuns: RUNS })
  }, TIMEOUT)

  it('should remove any subset of the listed entries', async () => {
    await fc.assert(fc.asyncProperty(shape, fc.nat(), async (generated, seed) => {
      fc.pre(generated.modules.length > 1)
      const doomed = generated.modules.filter((_, index) => (seed >> index) % 2 === 0)
      fc.pre(doomed.length > 0)

      for (const engine of engines) {
        await write(engine, generated.source)
        await removeNuxtConfigEntries((await readNuxtConfig(engine.cwd))!, { modules: doomed })

        const source = await read(engine)
        const context = describeShape(generated, { doomed, engine: engine.name, result: source })

        expect(isParseable(source), context).toBe(true)
        expect((await readNuxtConfig(engine.cwd))!.modules, context).toEqual(generated.modules.filter(name => !doomed.includes(name)))
      }
    }), { numRuns: RUNS })
  }, TIMEOUT)
})
