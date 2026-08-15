import type { DocsIndex } from '../../../src/utils/docs-index'

import { runCommand } from 'citty'
import { resolve } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import docs from '../../../src/commands/docs'
import { logger } from '../../../src/utils/logger'

const { openBrowser } = vi.hoisted(() => ({ openBrowser: vi.fn() }))
const { resolveDocsIndex } = vi.hoisted(() => ({ resolveDocsIndex: vi.fn<() => Promise<DocsIndex | undefined>>() }))
const { isInteractive, select } = vi.hoisted(() => ({
  isInteractive: vi.fn(() => false),
  select: vi.fn<(options: { options: { value: string }[] }) => Promise<string>>(),
}))

vi.mock('../../../src/dev/listen', () => ({ openBrowser }))
vi.mock('../../../src/utils/stdout', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/stdout')>(),
  isInteractive,
}))
vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  select,
}))
vi.mock('../../../src/utils/docs-index', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/docs-index')>(),
  resolveDocsIndex,
}))

const index: DocsIndex = {
  version: '4.5.2',
  base: '/docs/4.x',
  entries: [
    { title: 'Installation', description: 'Get started with Nuxt.', path: '/getting-started/installation', headings: ['Prerequisites'] },
    { title: 'Rendering Modes', description: 'Learn about rendering.', path: '/guide/concepts/rendering', headings: ['Route Rules', 'Hybrid Rendering'] },
    { title: 'useFetch', description: 'Fetch data from an API endpoint.', path: '/api/composables/use-fetch', headings: ['Type', 'Params'] },
  ],
}

function stdout(): { calls: string[], restore: () => void } {
  const calls: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    calls.push(String(chunk))
    return true
  })
  return { calls, restore: () => spy.mockRestore() }
}

describe('docs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    openBrowser.mockClear()
    resolveDocsIndex.mockReset()
    isInteractive.mockReturnValue(false)
    select.mockReset()
  })

  it('should open the documentation site without a query', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await runCommand(docs, { rawArgs: [] })

    expect(resolveDocsIndex).not.toHaveBeenCalled()
    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs')
    expect(info).toHaveBeenCalledWith(expect.stringContaining('https://nuxt.com/docs'))
  })

  it('should print the URL without opening it when asked not to', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await runCommand(docs, { rawArgs: ['--no-open'] })

    expect(openBrowser).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('https://nuxt.com/docs'))
  })

  it('should open the page a heading matches', async () => {
    resolveDocsIndex.mockResolvedValue(index)
    const out = stdout()
    await runCommand(docs, { rawArgs: ['route', 'rules'] })
    out.restore()

    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs/4.x/guide/concepts/rendering')
    expect(out.calls.join('')).toContain('Rendering Modes')
  })

  it('should treat every positional as part of the query', async () => {
    resolveDocsIndex.mockResolvedValue(index)
    const out = stdout()
    await runCommand(docs, { rawArgs: ['get', 'started', 'with', 'nuxt'] })
    out.restore()

    expect(resolveDocsIndex).toHaveBeenCalledWith(resolve('.'), expect.anything())
    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs/4.x/getting-started/installation')
  })

  it('should prefer a title match over a heading match', async () => {
    resolveDocsIndex.mockResolvedValue(index)
    const out = stdout()
    await runCommand(docs, { rawArgs: ['useFetch'] })
    out.restore()

    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs/4.x/api/composables/use-fetch')
  })

  it('should let an interactive user choose between matches', async () => {
    resolveDocsIndex.mockResolvedValue(index)
    isInteractive.mockReturnValue(true)
    select.mockResolvedValue('/api/composables/use-fetch')
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    await runCommand(docs, { rawArgs: ['e'] })

    expect(select).toHaveBeenCalledOnce()
    expect(select.mock.calls[0]![0].options.length).toBeGreaterThan(1)
    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs/4.x/api/composables/use-fetch')
  })

  it('should fall back to the site when nothing matches', async () => {
    resolveDocsIndex.mockResolvedValue(index)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await runCommand(docs, { rawArgs: ['zzzzzzzz'] })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('zzzzzzzz'))
    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs')
  })

  it('should fall back to the site when the docs cannot be resolved', async () => {
    resolveDocsIndex.mockResolvedValue(undefined)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await runCommand(docs, { rawArgs: ['route', 'rules'] })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Nuxt documentation'))
    expect(openBrowser).toHaveBeenCalledWith('https://nuxt.com/docs')
  })
})
