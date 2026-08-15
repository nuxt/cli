import process from 'node:process'

import { resolveModulePath } from 'exsolve'
import { join } from 'pathe'

import { debug } from './logger'

type ParseSync = (filename: string, source: string) => { program: any, errors: unknown[] }

/**
 * Parsers this module can read an AST from, in preference order. Both are
 * declared as optional peer dependencies, so a bare import resolves whichever
 * version the installed `nuxt` pinned.
 */
const PARSER_CANDIDATES = [
  { specifier: 'rolldown/utils', export: 'parseSync' },
  { specifier: 'oxc-parser', export: 'parseSync' },
] as const

/** Config keys holding a list of specifiers this module can edit. */
export const CONFIG_KEYS = ['modules', 'extends'] as const

export type ConfigKey = typeof CONFIG_KEYS[number]

/** Keys Nuxt also accepts as a bare string rather than an array. */
const SINGLE_VALUE_KEYS = new Set<ConfigKey>(['extends'])

function allElements(keys: Record<ConfigKey, ArrayLocation>): ArrayElement[] {
  return CONFIG_KEYS.flatMap(key => keys[key].elements)
}

const parserCache = new Map<string, Promise<ParseSync | undefined>>()

const SELF = Symbol('self')

/**
 * Places a parser may be reachable from, closest first.
 *
 * A project rarely depends on a parser directly, so most installs are found via
 * the project's `nuxt`. `SELF` means a bare import, which covers the optional
 * peer dependency: under pnpm that is the only way a parser is reachable from
 * `@nuxt/cli`, since peers are linked from `nuxt`'s dependencies and the project's
 * own `node_modules` does not expose them. `nuxi` and `npx nuxt` have no peers
 * installed and rely on the two roots before it.
 */
function resolutionRoots(cwd: string): (string | typeof SELF)[] {
  const from = join(cwd, '/')
  const nuxt = resolveModulePath('nuxt', { from, try: true })
  return nuxt ? [from, nuxt, SELF] : [from, SELF]
}

async function loadParser(cwd: string): Promise<ParseSync | undefined> {
  // Escape hatch for a project whose parser this module cannot read.
  if (process.env.NUXT_CLI_PARSER === 'scanner') {
    return
  }

  const roots = resolutionRoots(cwd)

  for (const from of roots) {
    for (const candidate of PARSER_CANDIDATES) {
      const path = from === SELF
        ? candidate.specifier
        : resolveModulePath(candidate.specifier, { from, try: true })
      if (!path) {
        continue
      }
      try {
        const module = await import(path)
        const parseSync = module[candidate.export] ?? module.default?.[candidate.export]
        if (typeof parseSync === 'function') {
          return parseSync as ParseSync
        }
      }
      catch (error) {
        debug(`Failed to load \`${candidate.specifier}\` from \`${from === SELF ? 'self' : from}\`:`, error)
      }
    }
  }
}

/**
 * Find the exported config object and the arrays this module can edit.
 *
 * Uses an oxc parser resolved from the project, falling back to a bracket scan
 * when the project has none. The scan understands strings, comments and nesting,
 * but not conditional or computed keys.
 */
export async function locateConfig(source: string, filename: string, cwd: string): Promise<ConfigLocation> {
  let parserPromise = parserCache.get(cwd)
  if (!parserPromise) {
    parserPromise = loadParser(cwd)
    parserCache.set(cwd, parserPromise)
  }
  const parseSync = await parserPromise

  if (parseSync) {
    try {
      return locateWithParser(parseSync, source, filename)
    }
    catch (error) {
      if (error instanceof ConfigShapeError) {
        throw error
      }
      debug('Falling back to scanning the config after a parser failure:', error)
    }
  }

  return locateWithScan(source)
}

/** Thrown for a config we understand but cannot edit, so it is never retried by the scanner. */
class ConfigShapeError extends Error {}

/**
 * Thrown when the resolved parser produced something other than the ESTree shape
 * this module knows how to read, so that the scanner is used instead.
 *
 * Misreading an AST is worse than not reading it: an unrecognised `modules`
 * property looks like an absent one, which would add a second `modules` key and
 * silently shadow the real list.
 */
class UnknownAstError extends Error {}

const ESTREE_PROPERTY_TYPES = new Set(['Property', 'SpreadElement'])
const LITERAL_SUFFIX_RE = /Literal$/

function locateWithParser(parseSync: ParseSync, source: string, filename: string): ConfigLocation {
  const { program, errors } = parseSync(filename, source)
  if (errors.length) {
    throw new Error(`Failed to parse ${filename}`)
  }
  if (!Array.isArray(program?.body)) {
    throw new UnknownAstError('the parser did not return an ESTree program')
  }

  const exported = program.body.find((node: any) => node.type === 'ExportDefaultDeclaration')
  if (!exported) {
    throw new ConfigShapeError('Default export is missing in the config file!')
  }

  // `export default defineNuxtConfig({ ... })` wraps the object we want to edit,
  // and either the call or the object may be wrapped again by `as`/`satisfies`.
  const called = unwrap(exported.declaration)
  const object = unwrap(called.type === 'CallExpression' ? called.arguments[0] : called)
  if (object?.type !== 'ObjectExpression') {
    throw new ConfigShapeError('Could not find a config object in the default export.')
  }

  if (!Array.isArray(object.properties) || object.properties.some((property: any) => !ESTREE_PROPERTY_TYPES.has(property?.type))) {
    throw new UnknownAstError('the config object does not hold ESTree properties')
  }

  const dynamic = object.properties.some((property: any) => property.type === 'SpreadElement' || property.computed === true)

  const propertyStarts = object.properties.map((property: any) => property.start)
  const keys = {} as Record<ConfigKey, ArrayLocation>

  for (const key of CONFIG_KEYS) {
    const property = object.properties.find((candidate: any) =>
      candidate.type === 'Property' && (candidate.key?.name ?? candidate.key?.value) === key,
    )
    keys[key] = property ? readArrayValue(property.value, key) : { elements: [] }
  }

  return {
    objectStart: object.start,
    propertyStarts,
    keys,
    dynamic,
    quote: detectQuote(source, allElements(keys)),
  }
}

function readArrayValue(value: any, key: ConfigKey): ArrayLocation {
  if (value?.type === 'ArrayExpression') {
    // `StringLiteral` and friends mean a Babel-shaped AST, where a string entry
    // would read as unnamed and be quietly dropped from the list.
    if (value.elements.some((element: any) => element?.type !== 'Literal' && LITERAL_SUFFIX_RE.test(element?.type ?? ''))) {
      throw new UnknownAstError(`the \`${key}\` array does not hold ESTree literals`)
    }

    return {
      array: { start: value.start, end: value.end },
      elements: value.elements.map((element: any) => ({
        start: element.start,
        end: element.end,
        name: readName(element),
      })),
    }
  }

  if (value?.type !== 'Literal' && LITERAL_SUFFIX_RE.test(value?.type ?? '')) {
    throw new UnknownAstError(`the \`${key}\` entry is not an ESTree literal`)
  }

  // `extends` also accepts a single layer as a string, which has to be widened
  // into an array before another entry can join it.
  if (SINGLE_VALUE_KEYS.has(key) && value?.type === 'Literal' && typeof value.value === 'string') {
    const single = { start: value.start, end: value.end }
    return { single, elements: [{ ...single, name: value.value }] }
  }

  throw new ConfigShapeError(`The \`${key}\` entry in the config file is not an array.`)
}

const TRANSPARENT_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSInstantiationExpression',
  'ParenthesizedExpression',
])

/** Strip type assertions and parentheses that do not change the value. */
function unwrap(node: any): any {
  let current = node
  while (current && TRANSPARENT_WRAPPERS.has(current.type)) {
    current = current.expression
  }
  return current
}

function readName(element: any): string | null {
  if (element?.type === 'Literal' && typeof element.value === 'string') {
    return element.value
  }
  // `['@nuxt/image', { quality: 80 }]` names the module in its first position.
  if (element?.type === 'ArrayExpression') {
    return readName(element.elements[0])
  }
  return null
}

/**
 * Pick the quote character a new entry should use.
 *
 * An entry already in the array is the most reliable signal. Failing that, string
 * literals elsewhere are counted, skipping comments so that an apostrophe in prose
 * does not decide the file's style.
 */
function detectQuote(source: string, elements: ArrayElement[]): string {
  for (const element of elements) {
    const char = source[element.start]
    if (char === '"' || char === '\'') {
      return char
    }
  }

  let single = 0
  let double = 0
  let at = 0
  while (at < source.length) {
    const next = skipTrivia(source, at)
    if (next !== at) {
      at = next
      continue
    }
    const char = source[at]
    if (char === '\'' || char === '"' || char === '`') {
      const end = findStringEnd(source, at)
      if (end === undefined) {
        break
      }
      if (char === '\'') {
        single++
      }
      else if (char === '"') {
        double++
      }
      at = end + 1
      continue
    }
    at++
  }

  return double > single ? '"' : '\''
}

/**
 * Locate the editable arrays by scanning, for projects with no oxc parser on disk.
 *
 * Only the shapes the CLI writes itself are supported: a key holding an array
 * literal (or, for `extends`, a single string), inside the object of a default
 * export.
 */
function locateWithScan(source: string): ConfigLocation {
  const objectStart = findDefaultExportObject(source)
  if (objectStart === undefined) {
    throw new ConfigShapeError('Default export is missing in the config file!')
  }

  const { properties, complete } = scanProperties(source, objectStart)
  const keys = {} as Record<ConfigKey, ArrayLocation>

  for (const key of CONFIG_KEYS) {
    const property = properties.find(candidate => candidate.key === key)
    keys[key] = property ? scanArrayValue(source, property.valueStart, key) : { elements: [] }
  }

  return {
    objectStart,
    propertyStarts: properties.map(property => property.start),
    keys,
    dynamic: !complete,
    quote: detectQuote(source, allElements(keys)),
  }
}

function scanArrayValue(source: string, valueStart: number, key: ConfigKey): ArrayLocation {
  const start = skipTrivia(source, valueStart)

  if (source[start] === '[') {
    const end = matchBracket(source, start)
    if (end === undefined) {
      throw new ConfigShapeError(`The \`${key}\` array in the config file is not terminated.`)
    }
    return { array: { start, end: end + 1 }, elements: scanElements(source, start, end) }
  }

  if (SINGLE_VALUE_KEYS.has(key) && (source[start] === '\'' || source[start] === '"')) {
    const end = findStringEnd(source, start)
    if (end === undefined) {
      throw new ConfigShapeError(`The \`${key}\` entry in the config file is not terminated.`)
    }
    const single = { start, end: end + 1 }
    return { single, elements: [{ ...single, name: readScannedName(source.slice(start, end + 1)) }] }
  }

  throw new ConfigShapeError(`The \`${key}\` entry in the config file is not an array.`)
}

const DEFAULT_EXPORT_RE = /\bexport\s+default\s+/g

function findDefaultExportObject(source: string): number | undefined {
  DEFAULT_EXPORT_RE.lastIndex = 0
  let match = DEFAULT_EXPORT_RE.exec(source)
  while (match) {
    let at = skipTrivia(source, match.index + match[0].length)
    // Step over `defineNuxtConfig(` and any other single-argument wrapper.
    while (at < source.length && /[\w$.]/.test(source[at]!)) {
      while (at < source.length && /[\w$.]/.test(source[at]!)) {
        at++
      }
      at = skipTrivia(source, at)
      if (source[at] !== '(') {
        break
      }
      at = skipTrivia(source, at + 1)
    }
    if (source[at] === '{') {
      return at
    }
    match = DEFAULT_EXPORT_RE.exec(source)
  }
}

interface ScannedProperty {
  key: string
  start: number
  valueStart: number
}

function scanProperties(source: string, objectStart: number): { properties: ScannedProperty[], complete: boolean } {
  const objectEnd = matchBracket(source, objectStart)
  if (objectEnd === undefined) {
    throw new ConfigShapeError('The config object is not terminated.')
  }

  const properties: ScannedProperty[] = []
  let complete = true
  let at = skipTrivia(source, objectStart + 1)

  while (at < objectEnd) {
    const start = at
    const key = readKey(source, at)
    if (!key) {
      complete = false
      break
    }
    at = skipTrivia(source, key.end)
    if (source[at] !== ':') {
      complete = false
      break
    }
    const valueStart = at + 1
    properties.push({ key: key.value, start, valueStart })

    const valueEnd = skipValue(source, valueStart, objectEnd)
    if (valueEnd === undefined) {
      complete = false
      break
    }
    at = skipTrivia(source, valueEnd)
    if (source[at] === ',') {
      at = skipTrivia(source, at + 1)
    }
  }

  return { properties, complete }
}

function readKey(source: string, at: number): { value: string, end: number } | undefined {
  const quote = source[at]
  if (quote === '\'' || quote === '"') {
    const end = findStringEnd(source, at)
    return end === undefined ? undefined : { value: source.slice(at + 1, end), end: end + 1 }
  }
  let end = at
  while (end < source.length && /[\w$]/.test(source[end]!)) {
    end++
  }
  return end === at ? undefined : { value: source.slice(at, end), end }
}

/** Advance past one property value, stopping at the `,` or `}` that ends it. */
function skipValue(source: string, from: number, limit: number): number | undefined {
  let at = skipTrivia(source, from)
  while (at < limit) {
    const char = source[at]!
    if (char === ',' || char === '}') {
      return at
    }
    if (char === '\'' || char === '"' || char === '`') {
      const end = findStringEnd(source, at)
      if (end === undefined) {
        return undefined
      }
      at = end + 1
      continue
    }
    if (char === '[' || char === '{' || char === '(') {
      const end = matchBracket(source, at)
      if (end === undefined) {
        return undefined
      }
      at = end + 1
      continue
    }
    at = skipTrivia(source, at + 1)
  }
  return at
}

function scanElements(source: string, arrayStart: number, arrayEnd: number): ArrayElement[] {
  const elements: ArrayElement[] = []
  let at = skipTrivia(source, arrayStart + 1)

  while (at < arrayEnd) {
    const start = at
    const end = skipValue(source, at, arrayEnd)
    if (end === undefined) {
      break
    }
    const text = source.slice(start, end).trimEnd()
    if (!text) {
      break
    }
    elements.push({ start, end: start + text.length, name: readScannedName(text) })

    at = skipTrivia(source, end)
    if (source[at] === ',') {
      at = skipTrivia(source, at + 1)
    }
    else {
      break
    }
  }

  return elements
}

const LEADING_STRING_RE = /^(['"])((?:[^\\]|\\.)*?)\1/

function readScannedName(text: string): string | null {
  const inner = text.startsWith('[') ? text.slice(1).trimStart() : text
  const match = LEADING_STRING_RE.exec(inner)
  return match ? match[2]!.replace(/\\(.)/g, '$1') : null
}

const CLOSING = { '[': ']', '{': '}', '(': ')' } as const

function matchBracket(source: string, at: number): number | undefined {
  const open = source[at] as keyof typeof CLOSING
  const close = CLOSING[open]
  let depth = 0
  let cursor = at

  while (cursor < source.length) {
    const char = source[cursor]!
    if (char === '\'' || char === '"' || char === '`') {
      const end = findStringEnd(source, cursor)
      if (end === undefined) {
        return undefined
      }
      cursor = end + 1
      continue
    }
    const skipped = skipTrivia(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped
      continue
    }
    if (char === open) {
      depth++
    }
    else if (char === close) {
      depth--
      if (depth === 0) {
        return cursor
      }
    }
    cursor++
  }
}

function findStringEnd(source: string, at: number): number | undefined {
  const quote = source[at]
  let cursor = at + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 2
      continue
    }
    if (char === quote) {
      return cursor
    }
    cursor++
  }
}

/** Advance past whitespace and comments. */
function skipTrivia(source: string, at: number): number {
  let cursor = at
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      cursor++
      continue
    }
    if (char === '/' && source[cursor + 1] === '/') {
      const newline = source.indexOf('\n', cursor)
      cursor = newline === -1 ? source.length : newline
      continue
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor)
      cursor = end === -1 ? source.length : end + 2
      continue
    }
    return cursor
  }
  return cursor
}

export interface ArrayElement {
  start: number
  end: number
  name: string | null
}

export interface ArrayLocation {
  /** Bounds of the array literal, or `undefined` when the key is absent or holds a single string. */
  array?: { start: number, end: number }
  /** Bounds of a lone string value, which has to be widened into an array to add to it. */
  single?: { start: number, end: number }
  elements: ArrayElement[]
}

export interface ConfigLocation {
  /** Offset of the `{` opening the exported config object. */
  objectStart: number
  /** Offsets of each property key in the exported object, used to match indentation. */
  propertyStarts: number[]
  keys: Record<ConfigKey, ArrayLocation>
  /**
   * Whether the object holds something that could define a key we cannot see: a
   * spread, a computed key, or (for the scanner) a property it could not read.
   * Adding a key such a config may already set would silently shadow it.
   */
  dynamic: boolean
  /** Quote character to use for new entries. */
  quote: string
}
