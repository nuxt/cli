import type { Option } from '@clack/prompts'
import type { NuxtModule } from './_utils'

import process from 'node:process'

import { styleText } from 'node:util'
import { autocompleteMultiselect, isCancel } from '@clack/prompts'
import fuzzysort from 'fuzzysort'
import { hasTTY } from 'std-env'

import { logger } from '../../utils/logger'

const TRAILING_DOT_RE = /\.$/

/**
 * Clack wraps each row at the terminal width less its `│  ` guide, and the row
 * itself opens with `◻ `; the last two columns are the gap this file puts
 * between the name and the description.
 */
const ROW_PREFIX_WIDTH = 3 + 2 + 2
/** Below this there is no room left for a description worth reading. */
const MIN_DESCRIPTION_WIDTH = 24

interface AutocompleteOptions {
  modules: NuxtModule[]
  message?: string
}

interface AutocompleteResult {
  selected: string[]
  cancelled: boolean
}

export async function selectModulesAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult> {
  const { modules, message = 'Search and select modules:' } = options

  if (!hasTTY) {
    logger.warn('Interactive module selection requires a TTY. Skipping.')
    return { selected: [], cancelled: false }
  }

  const sortedModules = modules.toSorted((a, b) => {
    if (a.type === 'official' && b.type !== 'official')
      return -1
    if (a.type !== 'official' && b.type === 'official')
      return 1
    return a.npm.localeCompare(b.npm)
  })

  const targets = sortedModules.map(m => ({
    value: m.npm,
    npm: fuzzysort.prepare(m.npm),
    name: fuzzysort.prepare(m.name),
    category: fuzzysort.prepare(m.category),
  }))

  /**
   * Clack only renders `hint` for the focused row, so the description lives in
   * the label instead and every row keeps it. Widths are measured on the plain
   * text: clack hard-wraps each row, and a label that overflows the terminal
   * costs a second line and half the visible list.
   */
  function buildOptions(search: string): Option<string>[] {
    const room = (process.stdout.columns || 80) - ROW_PREFIX_WIDTH
    return sortedModules.map((m) => {
      const match = search ? fuzzysort.single(search, m.npm) : undefined
      const name = match ? match.highlight(part => styleText('underline', part)).join('') : m.npm
      const description = m.description.replace(TRAILING_DOT_RE, '')
      const available = room - m.npm.length
      if (!description || available < MIN_DESCRIPTION_WIDTH) {
        return { value: m.npm, label: name }
      }
      const truncated = description.length > available
        ? `${description.slice(0, available - 1).trimEnd()}…`
        : description
      return { value: m.npm, label: `${name}  ${styleText('dim', truncated)}` }
    })
  }

  /**
   * `userInput` carries the text typed so far but is not on clack's public
   * prompt type, so a missing or renamed field degrades to unhighlighted rows
   * rather than throwing.
   */
  function currentSearch(prompt: unknown): string {
    const input = (prompt as { userInput?: unknown }).userInput
    return typeof input === 'string' ? input : ''
  }

  const matches = new Map<string, Set<string>>()
  const filter = (search: string, option: Option<string>): boolean => {
    if (!search)
      return true
    let results = matches.get(search)
    if (!results) {
      results = new Set(fuzzysort.go(search, targets, { keys: ['npm', 'name', 'category'], threshold: 0, limit: 0 }).map(r => r.obj.value))
      matches.set(search, results)
    }
    return results.has(option.value)
  }

  const result = await autocompleteMultiselect({
    message,
    options() {
      return buildOptions(currentSearch(this))
    },
    filter,
    required: false,
  })

  return isCancel(result)
    ? { selected: [], cancelled: true }
    : { selected: result, cancelled: false }
}
