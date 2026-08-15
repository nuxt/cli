import type { ArrayElement, ArrayLocation, ConfigKey, ConfigLocation } from './config-parse'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolveModulePath } from 'exsolve'

import { dirname, extname, join, normalize } from 'pathe'

import { CONFIG_KEYS, locateConfig } from './config-parse'
import { ActionableError } from './errors'

export interface NuxtConfigFile {
  /** Absolute path to the config file. */
  file: string
  /** Project directory the config was resolved from. */
  cwd: string
  /** Specifiers listed in `modules`, in source order, omitting entries that are not plain strings. */
  modules: string[]
  /** Layers listed in `extends`, in source order, omitting entries that are not plain strings. */
  extends: string[]
}

/** Specifiers to add to or remove from each editable config key. */
export type ConfigEntries = Partial<Record<ConfigKey, string[]>>

interface Edit {
  start: number
  end: number
  text: string
}

const RESOLVE_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml']
const EDITABLE_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts']

const LEADING_INDENT_RE = /^[ \t]*/
const OWN_LINE_RE = /\n[ \t]*$/
const LEADING_COMMA_RE = /^\s*,/
const TRAILING_COMMA_RE = /,\s*$/
const TRAILING_SPACE_RE = /\s$/

/** Reuse the file's own line ending so a CRLF config does not gain stray LFs. */
function detectEol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

/** Indentation of the line `index` sits on. */
function lineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index) + 1
  return LEADING_INDENT_RE.exec(source.slice(lineStart, index))![0]
}

/** Whether every key in the config object is quoted, so a new one should be too. */
function isQuotedKeys(source: string, location: ConfigLocation): boolean {
  return location.propertyStarts.length > 0
    && location.propertyStarts.every(start => source[start] === '"' || source[start] === '\'')
}

/** Resolve the project's `nuxt.config` and read the modules it lists. */
export async function readNuxtConfig(cwd: string): Promise<NuxtConfigFile | undefined> {
  const file = tryResolve('./nuxt.config', cwd)
    || tryResolve('./.config/nuxt.config', cwd)
    || tryResolve('./.config/nuxt', cwd)

  if (!file) {
    return undefined
  }

  const ext = extname(file)
  if (!EDITABLE_EXTENSIONS.includes(ext)) {
    throw new ActionableError(`Unsupported config file extension: ${ext} (${file}) (supported: ${EDITABLE_EXTENSIONS.join(', ')})`)
  }

  const source = await readFile(file, 'utf8')
  return toConfigFile(file, cwd, await locateConfig(source, file, cwd))
}

/** Write a new `nuxt.config.ts` containing `contents`. */
export async function createNuxtConfig(cwd: string, contents: string): Promise<NuxtConfigFile> {
  const file = join(cwd, 'nuxt.config.ts')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents, 'utf8')

  return toConfigFile(file, cwd, await locateConfig(contents, file, cwd))
}

/**
 * Append entries to the config's `modules` and `extends` arrays, creating an array
 * if the config has no such key. Entries already listed are ignored.
 *
 * Each array is edited as a text splice, so formatting, comments and quote style
 * elsewhere in the file survive untouched.
 */
export async function addNuxtConfigEntries(config: NuxtConfigFile, entries: ConfigEntries): Promise<void> {
  const source = await readFile(config.file, 'utf8')
  const location = await locateConfig(source, config.file, config.cwd)

  const edits: Edit[] = []
  const created: string[] = []

  for (const key of CONFIG_KEYS) {
    const array = location.keys[key]
    const listed = new Set(array.elements.map(element => element.name))
    const names = (entries[key] ?? []).filter(name => !listed.has(name))
    if (!names.length) {
      continue
    }

    if (array.array || array.single) {
      edits.push(buildInsert(source, location, array, names))
    }
    else {
      if (location.dynamic) {
        throw new ActionableError(`Could not add \`${key}\` to ${config.file}: the config spreads or computes keys, so a new \`${key}\` could be silently overridden. Add ${names.map(name => `\`${name}\``).join(', ')} to \`${key}\` by hand.`)
      }
      created.push(buildProperty(source, location, key, names))
    }
  }

  // Two new keys share the same anchor, so they are inserted as one edit rather
  // than as two splices competing for the same offset.
  if (created.length) {
    edits.push(buildPropertyInsert(source, location, created))
  }

  if (!edits.length) {
    return
  }

  await writeFile(config.file, applyEdits(source, edits), 'utf8')
}

/** Remove entries from the config's `modules` and `extends` arrays. Absent entries are ignored. */
export async function removeNuxtConfigEntries(config: NuxtConfigFile, entries: ConfigEntries): Promise<void> {
  const source = await readFile(config.file, 'utf8')
  const location = await locateConfig(source, config.file, config.cwd)

  const edits: Edit[] = []

  for (const key of CONFIG_KEYS) {
    const array = location.keys[key]
    const toRemove = new Set(entries[key] ?? [])
    const doomed = array.elements.filter(element => element.name !== null && toRemove.has(element.name))
    if (!doomed.length || !array.array) {
      continue
    }

    // Removing the last entries one by one would leave the brackets straddling a
    // blank line, so an emptied array is rewritten whole.
    if (doomed.length === array.elements.length) {
      edits.push({ start: array.array.start, end: array.array.end, text: '[]' })
      continue
    }

    edits.push(...doomed.map(element => buildRemoval(source, array, element)))

    const orphanedComma = findOrphanedComma(source, array, doomed)
    if (orphanedComma !== undefined) {
      edits.push({ start: orphanedComma, end: orphanedComma + 1, text: '' })
    }
  }

  if (!edits.length) {
    return
  }

  await writeFile(config.file, applyEdits(source, edits), 'utf8')
}

/**
 * Offset of a separator that would be left dangling after a removal.
 *
 * Dropping the final entry of an array written without a trailing comma promotes
 * the entry before it, which must then shed the comma it no longer needs.
 */
function findOrphanedComma(source: string, location: ArrayLocation, doomed: ArrayElement[]): number | undefined {
  const lastEntry = location.elements.at(-1)!
  if (!doomed.includes(lastEntry) || LEADING_COMMA_RE.test(source.slice(lastEntry.end, location.array!.end - 1))) {
    return undefined
  }
  // Only the one-entry-per-line layout keeps the promoted entry's comma; inline
  // removals already take their own separator with them.
  if (!OWN_LINE_RE.test(source.slice(0, lastEntry.start))) {
    return undefined
  }

  const survivor = location.elements.filter(element => !doomed.includes(element)).at(-1)
  if (!survivor) {
    return undefined
  }

  let at = survivor.end
  while (source[at] === ' ' || source[at] === '\t') {
    at++
  }
  return source[at] === ',' ? at : undefined
}

function toConfigFile(file: string, cwd: string, location: ConfigLocation): NuxtConfigFile {
  return {
    file,
    cwd,
    modules: readNames(location, 'modules'),
    extends: readNames(location, 'extends'),
  }
}

function readNames(location: ConfigLocation, key: ConfigKey): string[] {
  return location.keys[key].elements.map(element => element.name).filter((name): name is string => name !== null)
}

/** Splice edits into `source`, working backwards so earlier offsets stay valid. */
function applyEdits(source: string, edits: Edit[]): string {
  let result = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }
  return result
}

/** Render a `key: [...]` property for a config that has no such key yet. */
function buildProperty(source: string, location: ConfigLocation, key: ConfigKey, names: string[]): string {
  const name = isQuotedKeys(source, location) ? `${location.quote}${key}${location.quote}` : key
  return `${name}: [${quoteAll(location, names).join(', ')}]`
}

function buildPropertyInsert(source: string, location: ConfigLocation, properties: string[]): Edit {
  const at = location.objectStart + 1
  const eol = detectEol(source)
  const firstProperty = location.propertyStarts[0]

  if (firstProperty !== undefined && source.lastIndexOf('\n', firstProperty) > location.objectStart) {
    const indent = lineIndent(source, firstProperty)
    return { start: at, end: at, text: properties.map(property => `${eol}${indent}${property},`).join('') }
  }

  // An empty object needs no separator, and gains a stray comma if given one.
  const separator = location.propertyStarts.length ? ',' : ' '
  return { start: at, end: at, text: ` ${properties.join(', ')}${separator}` }
}

function quoteAll(location: ConfigLocation, names: string[]): string[] {
  return names.map(name => `${location.quote}${name}${location.quote}`)
}

function buildInsert(source: string, location: ConfigLocation, array: ArrayLocation, names: string[]): Edit {
  const entries = quoteAll(location, names)
  const eol = detectEol(source)

  // A lone string (`extends: 'layer'`) has to become an array to hold more.
  if (array.single) {
    const existing = source.slice(array.single.start, array.single.end)
    return { start: array.single.start, end: array.single.end, text: `[${[existing, ...entries].join(', ')}]` }
  }

  const close = array.array!.end - 1
  const closeLineStart = source.lastIndexOf('\n', close) + 1
  const last = array.elements.at(-1)

  // A `]` on its own line means one entry per line; anything else stays inline.
  const ownLine = closeLineStart > (last?.end ?? array.array!.start)

  if (!last) {
    if (!ownLine) {
      const at = array.array!.start + 1
      return { start: at, end: at, text: entries.join(', ') }
    }
    const closeIndent = source.slice(closeLineStart, close)
    const indent = closeIndent + (closeIndent.includes('\t') ? '\t' : '  ')
    return { start: closeLineStart, end: closeLineStart, text: entries.map(entry => `${indent}${entry},${eol}`).join('') }
  }

  if (ownLine) {
    // Everything between the last entry and the closing line is re-emitted so a
    // trailing comment stays with the entry it annotates, and a missing
    // separator is supplied for arrays written without a trailing comma.
    const region = source.slice(last.end, closeLineStart)
    const trailingComma = LEADING_COMMA_RE.test(region)
    const indent = lineIndent(source, last.start)
    const lines = entries.map((entry, index) => {
      const comma = trailingComma || index < entries.length - 1 ? ',' : ''
      return `${indent}${entry}${comma}${eol}`
    })
    return {
      start: last.end,
      end: closeLineStart,
      text: (trailingComma ? '' : ',') + region + lines.join(''),
    }
  }

  const region = source.slice(last.end, close)
  const separator = TRAILING_COMMA_RE.test(region)
    ? (TRAILING_SPACE_RE.test(region) ? '' : ' ')
    : ', '
  return { start: close, end: close, text: separator + entries.join(', ') }
}

function buildRemoval(source: string, location: ArrayLocation, element: ArrayElement): Edit {
  let start = element.start
  let end = element.end
  if (source[end] === ',') {
    end++
  }

  if (OWN_LINE_RE.test(source.slice(0, element.start))) {
    // Take the whole line, including its indentation, any trailing comment and
    // its newline, so no blank line is left behind.
    start = source.lastIndexOf('\n', element.start - 1) + 1
    const newline = source.indexOf('\n', end)
    return { start, end: newline === -1 ? source.length : newline + 1, text: '' }
  }

  // `['a', 'b']` keeps a stray separator unless the space after the comma goes
  // too, or the preceding comma when this was the final entry.
  while (source[end] === ' ') {
    end++
  }
  if (source[end] === ']') {
    const index = location.elements.indexOf(element)
    start = location.elements[index - 1]?.end ?? start
  }
  else if (source[end] === '\n' || source[end] === '\r') {
    // The entry ended the line, so take the space that separated it from the
    // previous one rather than leaving it dangling.
    while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
      start--
    }
  }
  return { start, end, text: '' }
}

function tryResolve(path: string, cwd: string) {
  const resolved = resolveModulePath(path, {
    try: true,
    from: join(cwd, '/'),
    extensions: RESOLVE_EXTENSIONS,
    suffixes: ['', '/index'],
    cache: false,
  })
  return resolved ? normalize(resolved) : undefined
}
