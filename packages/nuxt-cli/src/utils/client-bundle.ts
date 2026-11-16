import type { Nuxt } from '@nuxt/schema'

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { styleText } from 'node:util'
import { gzipSync } from 'node:zlib'

import { basename, join, relative } from 'pathe'

import { formatBytes, stripAnsi, truncate } from './formatting'

/** A JavaScript or CSS file of the client build, as Rolldown wrote it. */
export interface ClientFile {
  fileName: string
  kind: 'js' | 'css'
  size: number
  gzip: number
  isEntry: boolean
  isDynamicEntry: boolean
  /** The module the chunk is named after, such as the page or component it lazy loads. */
  source?: string
  imports: string[]
  dynamicImports: string[]
  css: string[]
  /** What the chunk is made of, as a share of its final size. */
  modules: Array<{ id: string, size: number, importers: string[] }>
}

/** Where a module comes from: an npm package, the app itself, or a module Nuxt or Vite generate. */
interface Origin {
  kind: 'package' | 'app' | 'virtual'
  name: string
  /** Directory the package is installed in, which tells two copies of it apart. */
  dir?: string
}

interface BundleGroup {
  name: string
  kind: Origin['kind']
  size: number
  gzip: number
  /** Bytes of it every page loads. */
  initial: number
  /** What brings it into the bundle: the app files and other packages importing it. */
  importedBy: string[]
}

interface BundleChunk {
  fileName: string
  size: number
  gzip: number
  role: 'entry' | 'initial' | 'lazy' | 'shared'
  /** The lazy-loaded page or component, or how many chunks share this one. */
  detail?: string
  /** The largest contributors to the chunk, largest first. */
  contents: string[]
}

export interface BundleSummary {
  js: { files: number, size: number, gzip: number }
  css: { files: number, size: number, gzip: number }
  initial: { size: number, gzip: number }
  groups: BundleGroup[]
  chunks: BundleChunk[]
  duplicates: Array<{ name: string, copies: Array<{ version?: string, importedBy: string[] }> }>
}

const NODE_MODULES = '/node_modules/'
const APP_GROUP = 'your app'
const QUERY_RE = /\?.*$/
const PACKAGE_NAME_RE = /^(@[^/]+\/[^/]+|[^/]+)/

function originOf(id: string, rootDir: string): Origin {
  if (id.startsWith('\0') || id.startsWith('virtual:') || id.includes('/.nuxt/')) {
    return { kind: 'virtual', name: 'virtual modules' }
  }
  const path = id.replace(QUERY_RE, '')
  const index = path.lastIndexOf(NODE_MODULES)
  if (index !== -1) {
    const name = path.slice(index + NODE_MODULES.length).match(PACKAGE_NAME_RE)?.[1]
    if (name) {
      return { kind: 'package', name, dir: path.slice(0, index + NODE_MODULES.length) + name }
    }
  }
  return { kind: 'app', name: relative(rootDir, path) }
}

/** A lazy chunk's source: the app file, or the file and the package it ships in. */
function describeSource(id: string, rootDir: string): string {
  const origin = originOf(id, rootDir)
  return origin.kind === 'package' ? `${basename(id.replace(QUERY_RE, ''))} (${origin.name})` : origin.name
}

interface RolldownChunk {
  type: 'chunk'
  fileName: string
  code: string
  isEntry: boolean
  isDynamicEntry: boolean
  facadeModuleId: string | null
  imports: string[]
  dynamicImports: string[]
  modules: Record<string, { renderedLength: number }>
  viteMetadata?: { importedCss: Set<string> }
}

interface RolldownAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

function byteLength(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
}

/**
 * Read the client build out of the bundle Rolldown is about to write. Module
 * sizes are measured before minification, so each one is scaled to its share
 * of the chunk's final size: close enough to rank what a chunk is made of.
 */
export function readClientBundle(bundle: Record<string, RolldownChunk | RolldownAsset>, getImporters: (id: string) => readonly string[] = () => []): ClientFile[] {
  const files: ClientFile[] = []
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') {
      const size = byteLength(output.code)
      // Modules that render to nothing are kept: a package's entry is often only
      // re-exports, and it is the one the app imports.
      const rendered = Object.entries(output.modules)
      const total = rendered.reduce((sum, [, module]) => sum + module.renderedLength, 0)
      files.push({
        fileName: output.fileName,
        kind: 'js',
        size,
        gzip: gzipSync(output.code).byteLength,
        isEntry: output.isEntry,
        isDynamicEntry: output.isDynamicEntry,
        source: output.facadeModuleId ?? undefined,
        imports: output.imports,
        dynamicImports: output.dynamicImports,
        css: [...output.viteMetadata?.importedCss ?? []],
        modules: rendered.map(([id, module]) => ({ id, size: total ? module.renderedLength / total * size : 0, importers: [...getImporters(id)] })),
      })
    }
    else if (output.fileName.endsWith('.css')) {
      files.push({
        fileName: output.fileName,
        kind: 'css',
        size: byteLength(output.source),
        gzip: gzipSync(output.source).byteLength,
        isEntry: false,
        isDynamicEntry: false,
        imports: [],
        dynamicImports: [],
        css: [],
        modules: [],
      })
    }
  }
  return files
}

/** The files every page loads: the entry, what it imports statically, and their CSS. */
function initialFiles(files: Map<string, ClientFile>): Set<string> {
  const initial = new Set<string>()
  const visit = (fileName: string) => {
    const file = files.get(fileName)
    if (!file || initial.has(fileName)) {
      return
    }
    initial.add(fileName)
    for (const next of [...file.imports, ...file.css]) {
      visit(next)
    }
  }
  for (const file of files.values()) {
    if (file.isEntry) {
      visit(file.fileName)
    }
  }
  return initial
}

function readVersion(dir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  }
  catch {
    return undefined
  }
}

export function summariseClientBundle(list: ClientFile[], rootDir: string, readPackageVersion = readVersion): BundleSummary {
  const files = new Map(list.map(file => [file.fileName, file]))
  const initial = initialFiles(files)
  const groups = new Map<string, BundleGroup>()
  const packageDirs = new Map<string, Map<string, Set<string>>>()
  const importers = new Map<string, number>()
  for (const file of list) {
    for (const fileName of file.imports) {
      importers.set(fileName, (importers.get(fileName) ?? 0) + 1)
    }
  }

  const summary: BundleSummary = {
    js: { files: 0, size: 0, gzip: 0 },
    css: { files: 0, size: 0, gzip: 0 },
    initial: { size: 0, gzip: 0 },
    groups: [],
    chunks: [],
    duplicates: [],
  }

  for (const file of list) {
    const totals = summary[file.kind]
    totals.files++
    totals.size += file.size
    totals.gzip += file.gzip
    const isInitial = initial.has(file.fileName)
    if (isInitial) {
      summary.initial.size += file.size
      summary.initial.gzip += file.gzip
    }
    if (file.kind === 'css') {
      continue
    }

    const contents = new Map<string, number>()
    for (const module of file.modules) {
      const origin = originOf(module.id, rootDir)
      // The app is one line of the totals, as a package is however many of its
      // files are bundled; a chunk lists app files by name, which is what
      // points at the component to lazy load.
      const key = origin.kind === 'app' ? APP_GROUP : origin.name
      let group = groups.get(key)
      if (!group) {
        groups.set(key, group = { name: key, kind: origin.kind, size: 0, gzip: 0, initial: 0, importedBy: [] })
      }
      for (const importer of module.importers) {
        const from = originOf(importer, rootDir).name
        if (from !== origin.name && !group.importedBy.includes(from)) {
          group.importedBy.push(from)
        }
      }
      group.size += module.size
      group.gzip += file.size ? module.size / file.size * file.gzip : 0
      if (isInitial) {
        group.initial += module.size
      }
      if (origin.dir) {
        let dirs = packageDirs.get(origin.name)
        if (!dirs) {
          packageDirs.set(origin.name, dirs = new Map())
        }
        let importedBy = dirs.get(origin.dir)
        if (!importedBy) {
          dirs.set(origin.dir, importedBy = new Set())
        }
        for (const importer of module.importers) {
          const from = originOf(importer, rootDir).name
          if (from !== origin.name) {
            importedBy.add(from)
          }
        }
      }
      contents.set(origin.name, (contents.get(origin.name) ?? 0) + module.size)
    }

    const lazySource = file.isDynamicEntry && file.source ? originOf(file.source, rootDir).name : undefined
    const role = file.isEntry ? 'entry' : isInitial ? 'initial' : file.isDynamicEntry ? 'lazy' : 'shared'
    summary.chunks.push({
      fileName: file.fileName,
      size: file.size,
      gzip: file.gzip,
      role,
      detail: role === 'lazy' && file.source
        ? describeSource(file.source, rootDir)
        : role === 'shared' ? `by ${importers.get(file.fileName) ?? 0} chunks` : undefined,
      contents: [...contents].filter(([, size]) => size > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name).filter(name => role !== 'lazy' || name !== lazySource),
    })
  }

  summary.groups = [...groups.values()].filter(group => group.size > 0).sort((a, b) => b.size - a.size)
  summary.chunks.sort((a, b) => b.size - a.size)
  for (const [name, dirs] of packageDirs) {
    if (dirs.size > 1) {
      summary.duplicates.push({
        name,
        copies: [...dirs].map(([dir, importedBy]) => ({ version: readPackageVersion(dir), importedBy: [...importedBy] })),
      })
    }
  }
  return summary
}

/** Whole bytes: module sizes are a share of their chunk, so rarely a whole number. */
const formatSize = (bytes: number) => formatBytes(Math.round(bytes))

/** Packages every Nuxt app ships, which no hint should suggest removing. */
const FRAMEWORK_RE = /^(?:vue|vue-router|nuxt|@vue\/.*|@nuxt\/.*|unhead|@unhead\/.*)$/
/** A package this large in the initial load is worth a look, whatever the app. */
const HEAVY_INITIAL = 50_000
const MAX_GROUPS = 8
const MAX_CHUNKS = 8
const MAX_CONTENTS = 3
/** Wide enough to tell a 5% package from a 10% one at a glance. */
const BAR_WIDTH = 20

function listImporters(importedBy: string[]): string {
  const shown = importedBy.slice(0, 2).join(', ')
  return importedBy.length > 2 ? `${shown} +${importedBy.length - 2}` : shown
}

function hints(summary: BundleSummary): string[] {
  const hints: string[] = []
  for (const { name, copies } of summary.duplicates) {
    const versions = copies.map(copy => [copy.version ?? 'unknown version', copy.importedBy.length && styleText('dim', `via ${listImporters(copy.importedBy)}`)].filter(Boolean).join(' '))
    hints.push(`${styleText('cyan', name)} is bundled ${copies.length} times: ${versions.join(', ')}. Deduplicate it in your lockfile.`)
  }
  for (const group of summary.groups) {
    if (group.kind === 'package' && group.initial >= HEAVY_INITIAL && !FRAMEWORK_RE.test(group.name)) {
      const via = group.importedBy.length ? ` ${styleText('dim', `via ${listImporters(group.importedBy)}`)}` : ''
      hints.push(`${styleText('cyan', group.name)} adds ${formatSize(group.initial)} to every page${via}. Import it only where needed, or lazy load the component using it.`)
    }
  }
  return hints
}

function row(cells: string[], widths: number[]): string {
  return cells.map((cell, index) => index === 0 ? cell.padEnd(widths[0]!) : cell.padStart(widths[index]!)).join('  ')
}

/** A package's share of the whole client bundle, as a bar and a percentage. */
function share(fraction: number): string {
  const filled = Math.max(1, Math.round(fraction * BAR_WIDTH))
  const bar = styleText('cyan', '█'.repeat(filled)) + styleText('dim', '░'.repeat(BAR_WIDTH - filled))
  return `${bar}  ${styleText('dim', `${Math.round(fraction * 100)}%`.padStart(4))}`
}

function describeChunk(chunk: BundleChunk): string {
  const role = chunk.role === 'entry'
    ? styleText('green', 'entry')
    : chunk.role === 'initial'
      ? styleText('green', 'every page')
      : chunk.role === 'lazy' ? styleText('yellow', 'lazy') : styleText('dim', 'shared')
  const contents = chunk.contents.slice(0, MAX_CONTENTS).join(', ') + (chunk.contents.length > MAX_CONTENTS ? ` +${chunk.contents.length - MAX_CONTENTS}` : '')
  return [role, chunk.detail, styleText('dim', contents)].filter(Boolean).join(' ')
}

/**
 * The summary printed at the end of `nuxt build`, wrapped to `columns`.
 * `projectDir` is the project relative to the current directory, which the
 * analyzer command names when it is not the current one.
 */
export function formatClientBundle(summary: BundleSummary, columns = 80, projectDir = ''): string {
  const total = summary.js.size + summary.css.size
  const totalGzip = summary.js.gzip + summary.css.gzip
  const lines: string[] = [
    `${styleText('bold', 'Bundle (client)')}  ${formatSize(total)} ${styleText('dim', `(${formatSize(totalGzip)} gzip)`)}  ${styleText('dim', `${summary.js.files} JS, ${summary.css.files} CSS`)}`,
    `${styleText('dim', 'Every page loads')} ${formatSize(summary.initial.size)} ${styleText('dim', `(${formatSize(summary.initial.gzip)} gzip)`)}`,
  ]

  const groups = summary.groups.slice(0, MAX_GROUPS)
  if (groups.length) {
    const widths = [Math.max(...groups.map(group => group.name.length)), 9, 9]
    lines.push('', styleText('dim', row(['By package', 'size', 'gzip'], widths)))
    for (const group of groups) {
      const name = group.kind === 'package' ? group.name.padEnd(widths[0]!) : styleText('dim', group.name.padEnd(widths[0]!))
      lines.push(`${row([name, formatSize(group.size), formatSize(group.gzip)], widths)}  ${share(total ? group.size / total : 0)}`)
    }
    const rest = summary.groups.slice(MAX_GROUPS)
    if (rest.length) {
      lines.push(styleText('dim', `+${rest.length} more, ${formatSize(rest.reduce((sum, group) => sum + group.size, 0))}`))
    }
  }

  const chunks = summary.chunks.slice(0, MAX_CHUNKS)
  if (chunks.length) {
    const widths = [Math.max(...chunks.map(chunk => chunk.fileName.length)), 9, 9]
    lines.push('', styleText('dim', row(['Largest chunks', 'size', 'gzip'], widths)))
    for (const chunk of chunks) {
      lines.push(`${row([chunk.fileName, formatSize(chunk.size), formatSize(chunk.gzip)], widths)}  ${describeChunk(chunk)}`)
    }
    if (summary.chunks.length > MAX_CHUNKS) {
      lines.push(styleText('dim', `+${summary.chunks.length - MAX_CHUNKS} more chunks`))
    }
  }

  // Hints wrap rather than truncate: each is a sentence to act on.
  const found = hints(summary).map(hint => `${styleText('yellow', '!')} ${hint}`)
  const analyze = `npx nuxt-bundle-analyzer${projectDir ? ` ${/\s/.test(projectDir) ? JSON.stringify(projectDir) : projectDir}` : ''}`
  const footer = styleText('dim', `See what each chunk imports with ${styleText('cyan', analyze)}`)
  return [...lines.map(line => truncate(line, columns)), ...(found.length ? ['', ...found] : []), '', footer].join('\n')
}

/**
 * Collect the client build while Vite writes it, so `nuxt build` can end with
 * what it shipped instead of Vite's list of every file. Returns undefined
 * until the client is built, and always with a builder other than Vite.
 */
export function collectClientBundle(nuxt: Nuxt): () => BundleSummary | undefined {
  let files: ClientFile[] | undefined
  nuxt.hook('vite:extendConfig', (config, { isClient }) => {
    if (!isClient) {
      return
    }
    // Vite would gzip every file to print a size the summary prints instead.
    for (const build of [config.build, config.environments?.client?.build]) {
      if (build) {
        build.reportCompressedSize = false
      }
    }
    // Vite lists every file it writes once the bundle is out, which is after
    // the summary has read their names. The logger is shared with the server
    // build, so only lists naming a client file are dropped.
    const logger = config.customLogger
    if (logger) {
      const info = logger.info.bind(logger)
      logger.info = (msg, options) => {
        const text = stripAnsi(msg)
        if (!files?.some(file => text.includes(file.fileName))) {
          info(msg, options)
        }
      }
    }
    config.plugins?.push({
      name: 'nuxi:client-bundle-summary',
      applyToEnvironment: environment => environment.name === 'client',
      generateBundle(_options, bundle) {
        files = readClientBundle(bundle as unknown as Record<string, RolldownChunk | RolldownAsset>, (id) => {
          const info = this.getModuleInfo(id)
          return info ? [...info.importers, ...info.dynamicImporters] : []
        })
      },
    })
  })
  return () => files && summariseClientBundle(files, nuxt.options.rootDir)
}
