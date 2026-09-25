import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { dirname, join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDocsIndex } from '../../../src/utils/docs-index'

const { resolveRegistryVersion } = vi.hoisted(() => ({ resolveRegistryVersion: vi.fn<() => Promise<string | undefined>>() }))

vi.mock('../../../src/utils/versions', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/versions')>(),
  resolveRegistryVersion,
}))

let cwd: string
let cacheHome: string

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), 'nuxt-docs-cache-'))
  vi.stubEnv('XDG_CACHE_HOME', cacheHome)
  // Nothing in these tests may reach the network: an unmocked download is a failure to fetch.
  resolveRegistryVersion.mockResolvedValue(undefined)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resolveRegistryVersion.mockReset()
  for (const dir of [cwd, cacheHome]) {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function createProject(version: string, files: Record<string, string>): string {
  cwd = mkdtempSync(join(tmpdir(), 'nuxt-docs-index-'))
  const root = join(cwd, 'node_modules/@nuxt/docs')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@nuxt/docs', version, exports: { './*': './*' } }))
  const nuxt = join(cwd, 'node_modules/nuxt')
  mkdirSync(nuxt, { recursive: true })
  writeFileSync(join(nuxt, 'package.json'), JSON.stringify({ name: 'nuxt', version, exports: { './package.json': './package.json' } }))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'project', dependencies: { nuxt: version } }))
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  return cwd
}

/** A `@nuxt/docs` tarball, laid out as npm publishes one: everything under `package/`. */
function createTarball(files: Record<string, string>): ArrayBuffer {
  const dir = mkdtempSync(join(tmpdir(), 'nuxt-docs-tarball-'))
  try {
    for (const [path, contents] of Object.entries({ 'package.json': JSON.stringify({ name: '@nuxt/docs' }), ...files })) {
      const file = join(dir, 'package', path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, contents)
    }
    execFileSync('tar', ['-czf', join(dir, 'docs.tgz'), '-C', dir, 'package'])
    const contents = readFileSync(join(dir, 'docs.tgz'))
    return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function page(title: string, description?: string, body = ''): string {
  return `---\ntitle: '${title}'\n${description ? `description: '${description}'\n` : ''}---\n\n${body}`
}

describe('resolveDocsIndex', () => {
  it('should be undefined when the docs are not installed', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'nuxt-docs-index-'))
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'project' }))

    await expect(resolveDocsIndex(cwd)).resolves.toBeUndefined()
  })

  it('should map a file path onto its documentation path', async () => {
    const project = createProject('4.5.2', {
      '1.getting-started/02.installation.md': page('Installation', 'Get started.'),
      '2.directory-structure/1.app/1.middleware.md': page('middleware'),
      '4.api/3.utils/$fetch.md': page('$fetch'),
    })

    const index = await resolveDocsIndex(project)

    expect(index?.entries.map(entry => entry.path).sort()).toEqual([
      '/api/utils/$fetch',
      '/directory-structure/app/middleware',
      '/getting-started/installation',
    ])
  })

  it('should serve each major version from its own base', async () => {
    expect((await resolveDocsIndex(createProject('4.5.2', { 'a.md': page('A') })))?.base).toBe('/docs/4.x')
    expect((await resolveDocsIndex(createProject('3.17.0', { 'a.md': page('A') })))?.base).toBe('/docs/3.x')
    expect((await resolveDocsIndex(createProject('nightly', { 'a.md': page('A') })))?.base).toBe('/docs')
  })

  it('should drop the index segment from a section landing page', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', { '3.guide/4.modules/index.md': page('Modules') }))

    expect(index?.entries[0]?.path).toBe('/guide/modules')
  })

  it('should collect section headings', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', {
      'a.md': page('Rendering Modes', 'How Nuxt renders.', '## Route Rules\n\ntext\n\n### Hybrid `Rendering`\n\n#### Too deep\n'),
    }))

    expect(index?.entries[0]?.headings).toEqual(['Route Rules', 'Hybrid Rendering'])
  })

  it('should skip pages that redirect or are hidden from navigation', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', {
      'kept.md': page('Kept'),
      'redirects.md': '---\nredirect: /guide\n---\n',
      'hidden.md': '---\nnavigation: false\n---\n',
    }))

    expect(index?.entries.map(entry => entry.title)).toEqual(['Kept'])
  })

  it('should fall back to the file name when a page has no title', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', { '1.guide/9.hooks.md': 'no frontmatter here' }))

    expect(index?.entries[0]).toMatchObject({ title: 'hooks', path: '/guide/hooks' })
  })

  it('should ignore a readme and non-markdown files', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', {
      'README.md': page('Readme'),
      'assets/logo.svg': '<svg />',
      'guide.md': page('Guide'),
    }))

    expect(index?.entries.map(entry => entry.title)).toEqual(['Guide'])
  })

  it('should read the installed docs afresh rather than from the cache', async () => {
    const project = createProject('4.5.2', { 'guide.md': page('Guide') })
    expect((await resolveDocsIndex(project))?.entries.map(entry => entry.title)).toEqual(['Guide'])

    writeFileSync(join(project, 'node_modules/@nuxt/docs/guide.md'), page('Renamed'))
    expect((await resolveDocsIndex(project))?.entries.map(entry => entry.title)).toEqual(['Renamed'])
  })

  it('should strip control characters from indexed titles and descriptions', async () => {
    const index = await resolveDocsIndex(createProject('4.5.2', {
      'guide.md': '---\ntitle: "Guide\\e[31m"\ndescription: "Read\\a me"\n---\n',
    }))

    expect(index?.entries[0]).toMatchObject({ title: 'Guide[31m', description: 'Read me' })
  })

  it('should fetch the docs published for the project\'s Nuxt version when none are installed', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'nuxt-docs-index-'))
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'project', dependencies: { nuxt: '4.5.2' } }))
    resolveRegistryVersion.mockResolvedValue('4.5.2')
    const tarball = createTarball({ 'guide.md': page('Fetched') })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(tarball))
    const onDownload = vi.fn()

    const index = await resolveDocsIndex(cwd, { onDownload })

    expect(onDownload).toHaveBeenCalledWith('4.5.2')
    expect(fetchSpy.mock.calls[0]![0]).toContain('/@nuxt/docs/-/docs-4.5.2.tgz')
    expect(index).toMatchObject({ version: '4.5.2', base: '/docs/4.x' })
    expect(index?.entries.map(entry => entry.title)).toEqual(['Fetched'])

    // The fetched index is cached, so a second search does not hit the registry.
    fetchSpy.mockClear()
    expect((await resolveDocsIndex(cwd))?.entries.map(entry => entry.title)).toEqual(['Fetched'])
    expect(fetchSpy).not.toHaveBeenCalled()

    // A project configuring another registry gets its own cache entry.
    writeFileSync(join(cwd, '.npmrc'), 'registry=https://proxy.example.com/npm/\n')
    fetchSpy.mockResolvedValue(new Response(createTarball({ 'guide.md': page('Proxied') })))
    expect((await resolveDocsIndex(cwd))?.entries.map(entry => entry.title)).toEqual(['Proxied'])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    rmSync(join(cwd, '.npmrc'))
    fetchSpy.mockClear()
    expect((await resolveDocsIndex(cwd))?.entries.map(entry => entry.title)).toEqual(['Fetched'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should download from npm when the configured registry rejects the request', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'nuxt-docs-index-'))
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'project', dependencies: { nuxt: '4.5.2' } }))
    writeFileSync(join(cwd, '.npmrc'), 'registry=https://proxy.example.com/npm/\n')
    const tarball = createTarball({ 'guide.md': page('Fetched') })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(tarball))

    const index = await resolveDocsIndex(cwd)

    expect(fetchSpy.mock.calls.map(call => call[0])).toEqual([
      'https://proxy.example.com/npm/@nuxt/docs/-/docs-4.5.2.tgz',
      'https://registry.npmjs.org/@nuxt/docs/-/docs-4.5.2.tgz',
    ])
    expect(index?.entries.map(entry => entry.title)).toEqual(['Fetched'])
  })

  it('should be undefined when the package holds no pages', async () => {
    await expect(resolveDocsIndex(createProject('4.5.2', { 'README.md': page('Readme') }))).resolves.toBeUndefined()
  })
})
