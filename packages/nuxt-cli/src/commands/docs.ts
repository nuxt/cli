import type { DocsEntry, DocsIndex } from '../utils/docs-index'

import process from 'node:process'
import { styleText } from 'node:util'

import { cancel, isCancel, select } from '@clack/prompts'
import { defineCommand } from 'citty'

import { openBrowser } from '../dev/listen'
import { releaseStdin, withDirectStdout } from '../utils/console'
import { DOCS_BASE_URL, DOCS_PATH, resolveDocsIndex } from '../utils/docs-index'
import { logger } from '../utils/logger'
import { resolveRootDir } from '../utils/paths'
import { withSpinner } from '../utils/spinner'
import { isInteractive } from '../utils/stdout'
import { cwdArgs } from './_shared'

const MAX_RESULTS = 8

export default defineCommand({
  meta: {
    name: 'docs',
    description: 'Search or open the Nuxt documentation',
  },
  args: {
    query: {
      type: 'positional',
      description: 'Words to search the documentation for',
      required: false,
    },
    ...cwdArgs,
    open: {
      type: 'boolean',
      description: 'Open the best match in a browser',
      negativeDescription: 'Print the matching pages without opening a browser',
      default: true,
    },
  },
  async run(ctx) {
    const query = ctx.args._.join(' ').trim()
    if (!query) {
      return visit(DOCS_PATH, ctx.args.open)
    }

    const found = await withSpinner(`Searching the Nuxt documentation for ${styleText('cyan', query)}`, async (spinner) => {
      const index = await resolveDocsIndex(resolveRootDir(ctx.args), {
        onDownload: version => spinner.update(`Downloading the Nuxt ${version} documentation`),
        onIndex: version => spinner.update(`Indexing the Nuxt ${version} documentation`),
      })
      if (!index) {
        return undefined
      }
      spinner.update(`Searching the Nuxt ${index.version} documentation for ${styleText('cyan', query)}`)
      const results = await search(index, query)
      spinner.done(`Searched ${index.entries.length} pages of the Nuxt ${index.version} documentation`)
      return { index, results }
    })

    if (!found) {
      logger.warn(`Could not read the Nuxt documentation for this project. Run again with ${styleText('cyan', 'DEBUG=nuxi*')} to see why.`)
      return visit(DOCS_PATH, ctx.args.open)
    }

    const { index, results } = found
    if (results.length === 0) {
      logger.warn(`Nothing in the Nuxt ${index.version} documentation matches ${styleText('cyan', query)}.`)
      return visit(DOCS_PATH, ctx.args.open)
    }

    if (results.length > 1 && ctx.args.open && isInteractive()) {
      const choice = await withDirectStdout(() => select<string>({
        message: `Which page would you like to open?`,
        initialValue: results[0]!.path,
        options: results.map(({ title, description, path }) => ({
          value: path,
          label: title,
          hint: description || path,
        })),
      }))
      releaseStdin()
      if (isCancel(choice)) {
        cancel(`Nuxt documentation: ${DOCS_BASE_URL}${index.base}${results[0]!.path}`)
        return
      }
      return visit(index.base + choice, true)
    }

    const width = Math.max(...results.map(entry => entry.title.length))
    const lines = results.map(({ title, description, path }, position) => {
      const label = `  ${position === 0 ? styleText('green', '>') : ' '} ${styleText('bold', title.padEnd(width))}`
      return `${label}  ${styleText('gray', description || path)}`
    })
    process.stdout.write(`${lines.join('\n')}\n`)

    return visit(index.base + results[0]!.path, ctx.args.open)
  },
})

function visit(path: string, open: boolean): void {
  const url = DOCS_BASE_URL + path
  logger.info(`${open ? 'Opening' : 'Nuxt documentation:'} ${styleText('cyan', url)}`)
  if (open) {
    openBrowser(url)
  }
}

/**
 * Rank pages by title first, then by their section headings, then by description.
 * A page whose heading names the query is usually a better answer than one that
 * merely mentions it in prose, so headings are scored rather than full text.
 */
async function search(index: DocsIndex, query: string): Promise<DocsEntry[]> {
  const { default: fuzzysort } = await import('fuzzysort')
  const scored = index.entries.map((entry) => {
    const title = fuzzysort.single(query, entry.title)?.score ?? 0
    const heading = Math.max(0, ...entry.headings.map(value => fuzzysort.single(query, value)?.score ?? 0))
    const description = fuzzysort.single(query, entry.description || '')?.score ?? 0
    const path = fuzzysort.single(query, entry.path)?.score ?? 0
    return { entry, score: Math.max(title, heading * 0.9, path * 0.8, description * 0.6) }
  })

  return scored
    .filter(result => result.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(result => result.entry)
}
