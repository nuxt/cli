import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { parseYAML } from 'confbox/yaml'
import { resolveModulePath } from 'exsolve'
import { dirname, join, relative } from 'pathe'

import { getCacheDir } from './cache'
import { debug } from './logger'
import { detectNpmRegistry, PUBLIC_REGISTRY } from './registry'
import { getNuxtVersion, resolveRegistryVersion } from './versions'

export interface DocsEntry {
  title: string
  description?: string
  /** Path within the documentation, e.g. `/getting-started/installation`, to be joined onto {@link DocsIndex.base}. */
  path: string
  /** Section headings within the page, used to match a query against page content. */
  headings: string[]
}

export interface DocsIndex {
  version: string
  /** Path prefix nuxt.com serves this version's documentation under, e.g. `/docs/4.x`. */
  base: string
  entries: DocsEntry[]
}

interface Frontmatter {
  title?: string
  description?: string
  navigation?: boolean | Record<string, unknown>
  redirect?: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const HEADING_RE = /^#{2,3} ([^\n]*)$/gm
const ORDER_PREFIX_RE = /^\d+\./
const MARKDOWN_EXTENSION_RE = /\.md$/
const MAJOR_VERSION_RE = /^\d+$/
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const MARKDOWN_SYNTAX_RE = /[`*_[\]]|\{[^}]*\}/g

export const DOCS_BASE_URL = 'https://nuxt.com'
export const DOCS_PATH = '/docs'

/** The docs for a released Nuxt version never change, so a built index is kept for good. */
const CACHE_DIR = 'docs'
const DOCS_PACKAGE = '@nuxt/docs'
const FETCH_TIMEOUT = 10_000
const MAX_TARBALL_BYTES = 20 * 1024 * 1024
const UNSAFE_KEY_RE = /[^\w.+-]/g

/**
 * The searchable index of the documentation for the Nuxt version `cwd` uses.
 *
 * `@nuxt/docs` is the `docs/` directory of `nuxt/nuxt` published as raw markdown
 * and versioned in lockstep, so searching it answers against the docs for the
 * version in use rather than whatever is currently on the site. A copy installed
 * in the project is preferred; otherwise the matching tarball is fetched from the
 * registry, which is why the first search can be slow, and why the index is
 * cached in the user's cache home afterwards.
 *
 * Returns `undefined` when the docs can be neither read nor fetched, leaving the
 * caller to fall back to the documentation site.
 */
export async function resolveDocsIndex(cwd: string, options: DocsIndexProgress = {}): Promise<DocsIndex | undefined> {
  const nuxtVersion = await getNuxtVersion(cwd).catch(() => undefined)
  const cached = readCache(nuxtVersion)
  if (cached) {
    return cached
  }

  const local = localDocs(cwd)
  const index = local && (!nuxtVersion || sameMajor(local.version, nuxtVersion))
    ? indexLocal(local, options)
    : await fetchIndex(cwd, nuxtVersion, options) ?? (local && indexLocal(local, options))

  if (index) {
    writeCache(nuxtVersion, index)
  }
  return index || undefined
}

export interface DocsIndexProgress {
  /** Called with the version whose docs are about to be downloaded. */
  onDownload?: (version: string) => void
  /** Called with the version whose downloaded or installed docs are about to be read. */
  onIndex?: (version: string) => void
}

function indexLocal(local: { root: string, version: string }, options: DocsIndexProgress): DocsIndex | undefined {
  options.onIndex?.(local.version)
  return buildIndex(local.root, local.version)
}

/** A copy of `@nuxt/docs` installed in the project, ignoring `NODE_PATH`. */
function localDocs(cwd: string): { root: string, version: string } | undefined {
  const manifest = resolveModulePath(`${DOCS_PACKAGE}/package.json`, { from: join(cwd, '/'), try: true })
  if (!manifest) {
    return undefined
  }
  try {
    const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
    return version ? { root: dirname(manifest), version } : undefined
  }
  catch (error) {
    debug('Could not read the installed documentation:', error)
    return undefined
  }
}

/**
 * Download and index the docs for `nuxtVersion`.
 *
 * The tarball for that exact version is tried first, so the usual case costs a
 * single request. Docs are published alongside Nuxt releases, but a version may
 * predate the package or be a nightly, so the highest release sharing its major
 * (then whatever is latest) is accepted as a stand-in.
 */
async function fetchIndex(cwd: string, nuxtVersion: string | undefined, options: DocsIndexProgress): Promise<DocsIndex | undefined> {
  const attempted = new Set<string>()
  for await (const version of candidateVersions(nuxtVersion)) {
    if (attempted.has(version)) {
      continue
    }
    attempted.add(version)
    const index = await downloadIndex(cwd, version, options)
    if (index) {
      return index
    }
  }
  debug(`No published ${DOCS_PACKAGE} could be downloaded for Nuxt ${nuxtVersion || 'latest'}.`)
  return undefined
}

async function* candidateVersions(nuxtVersion: string | undefined): AsyncGenerator<string> {
  const major = nuxtVersion?.split('.')[0]
  if (nuxtVersion && EXACT_VERSION_RE.test(nuxtVersion)) {
    yield nuxtVersion
  }
  for (const range of [major && MAJOR_VERSION_RE.test(major) ? `^${major}` : undefined, 'latest']) {
    const resolved = range && await resolveRegistryVersion(DOCS_PACKAGE, range)
    if (resolved) {
      yield resolved
    }
  }
}

async function downloadIndex(cwd: string, version: string, options: DocsIndexProgress): Promise<DocsIndex | undefined> {
  options.onDownload?.(version)
  const staging = mkdtempSync(join(getCacheDir(CACHE_DIR), '.staging-'))
  try {
    const tarball = await downloadTarball(cwd, version)
    if (!tarball) {
      return undefined
    }
    const archive = join(staging, 'docs.tgz')
    writeFileSync(archive, tarball)
    assertSafeArchiveMembers(archive)
    // `tar` ships with macOS, Linux and Windows 10 onwards. The archive's
    // `package/` wrapper is stripped so paths match an installed copy.
    execFileSync('tar', ['-xzf', archive, '-C', staging, '--strip-components=1'], { stdio: 'ignore' })
    options.onIndex?.(version)
    return buildIndex(staging, version)
  }
  catch (error) {
    debug(`Could not read ${DOCS_PACKAGE}@${version}:`, error)
    return undefined
  }
  finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Refuse an archive whose member paths could escape the extraction directory:
 * absolute paths, drive letters, or `..` segments. The registry tarball is
 * still a download, and `tar`'s own handling of such members varies across
 * the system implementations this relies on.
 */
function assertSafeArchiveMembers(archive: string): void {
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
  for (const member of listing.split('\n')) {
    if (!member) {
      continue
    }
    if (member.startsWith('/') || member.startsWith('\\') || /^[a-z]:/i.test(member) || member.split(/[\\/]/).includes('..')) {
      throw new Error(`Refusing to extract unsafe archive member \`${member}\``)
    }
  }
}

/**
 * The `@nuxt/docs` tarball from the configured registry, falling back to npm
 * itself: the docs are a public package, so a proxy that rejects this process is
 * no reason to give up on them.
 */
async function downloadTarball(cwd: string, version: string): Promise<Buffer | undefined> {
  const { registry, authorization } = await detectNpmRegistry('@nuxt', cwd)
  const sources: [registry: string, authorization: string | null][] = [[registry, authorization]]
  if (registry !== PUBLIC_REGISTRY) {
    sources.push([PUBLIC_REGISTRY, null])
  }

  for (const [source, credentials] of sources) {
    try {
      const response = await fetch(`${source}/${DOCS_PACKAGE}/-/docs-${version}.tgz`, {
        headers: credentials ? { Authorization: credentials } : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!response.ok) {
        throw new Error(`Unexpected response: ${response.status}`)
      }
      return await readCapped(response)
    }
    catch (error) {
      debug(`Could not download ${DOCS_PACKAGE}@${version} from ${source}:`, error)
    }
  }
}

/**
 * The response body, refusing anything larger than a plausible docs tarball (the
 * real one is under half a megabyte) so a wrong or hostile URL cannot be streamed
 * into memory unbounded. `Content-Length` is advisory, so the limit is enforced
 * while reading.
 */
async function readCapped(response: Response): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.length
    if (size > MAX_TARBALL_BYTES) {
      throw new Error(`Response is larger than ${MAX_TARBALL_BYTES} bytes`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function sameMajor(a: string, b: string): boolean {
  return a.split('.')[0] === b.split('.')[0]
}

function buildIndex(root: string, version: string): DocsIndex | undefined {
  try {
    const entries: DocsEntry[] = []
    for (const file of markdownFiles(root)) {
      const entry = readEntry(root, file)
      if (entry) {
        entries.push(entry)
      }
    }
    if (entries.length === 0) {
      return undefined
    }
    const major = version.split('.')[0]
    return { version, base: MAJOR_VERSION_RE.test(major || '') ? `${DOCS_PATH}/${major}.x` : DOCS_PATH, entries }
  }
  catch (error) {
    debug('Could not read the documentation:', error)
    return undefined
  }
}

/**
 * Keyed by the Nuxt version asked about rather than the docs version resolved for
 * it, so a project on a Nuxt release with no docs of its own does not repeat the
 * registry lookup that found the stand-in.
 */
function cacheFile(nuxtVersion: string | undefined): string {
  // A version can be anything a `package.json` or a dependency specifier holds, so
  // it is reduced to a file name rather than trusted as one.
  const key = (nuxtVersion || 'latest').replace(UNSAFE_KEY_RE, '_')
  return join(getCacheDir(CACHE_DIR), `index-${key}.json`)
}

function readCache(nuxtVersion: string | undefined): DocsIndex | undefined {
  try {
    const cached = JSON.parse(readFileSync(cacheFile(nuxtVersion), 'utf8')) as DocsIndex
    return cached.entries?.length > 0 ? cached : undefined
  }
  catch {
    return undefined
  }
}

function writeCache(nuxtVersion: string | undefined, index: DocsIndex): void {
  try {
    writeFileSync(cacheFile(nuxtVersion), JSON.stringify(index), 'utf8')
  }
  catch (error) {
    debug('Could not cache the documentation index:', error)
  }
}

/**
 * Only regular files and directories are considered: a symlink in the archive
 * would otherwise be read through, reaching outside the extracted tree.
 */
function* markdownFiles(dir: string): Generator<string> {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) {
      yield* markdownFiles(path)
    }
    else if (item.isFile() && item.name.endsWith('.md') && item.name !== 'README.md') {
      yield path
    }
  }
}

function readEntry(root: string, file: string): DocsEntry | undefined {
  const source = readFileSync(file, 'utf8')
  const matter = FRONTMATTER_RE.exec(source)
  const data = matter ? parseFrontmatter(matter[1]!) : {}

  // A page that only redirects elsewhere, or is hidden from navigation, is not a
  // destination worth offering.
  if (data.redirect || data.navigation === false) {
    return undefined
  }

  const path = toSitePath(relative(root, file))
  const title = data.title?.trim() || path.split('/').pop() || path
  return {
    title,
    description: data.description?.trim(),
    path,
    headings: [...source.matchAll(HEADING_RE)].map(match => clean(match[1]!)),
  }
}

function parseFrontmatter(block: string): Frontmatter {
  try {
    return parseYAML<Frontmatter>(block) || {}
  }
  catch {
    return {}
  }
}

/**
 * `1.getting-started/02.installation.md` names `/getting-started/installation`.
 * Ordering prefixes and `index` segments exist for the site's file-based routing
 * and are not part of the URL.
 */
function toSitePath(file: string): string {
  const segments = file.replace(MARKDOWN_EXTENSION_RE, '').split('/').map(segment => segment.replace(ORDER_PREFIX_RE, ''))
  if (segments.at(-1) === 'index') {
    segments.pop()
  }
  return segments.length > 0 ? `/${segments.join('/')}` : ''
}

function clean(heading: string): string {
  return heading.replace(MARKDOWN_SYNTAX_RE, '').trim()
}
