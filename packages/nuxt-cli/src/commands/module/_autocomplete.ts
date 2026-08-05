import type { Option } from '@clack/prompts'
import type { NuxtModule } from './_utils'

import { autocompleteMultiselect, isCancel } from '@clack/prompts'
import fuzzysort from 'fuzzysort'
import { hasTTY } from 'std-env'

import { logger } from '../../utils/logger'

const TRAILING_DOT_RE = /\.$/

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

  const clackOptions: Option<string>[] = sortedModules.map(m => ({
    value: m.npm,
    label: m.npm,
    hint: m.description.replace(TRAILING_DOT_RE, ''),
  }))

  const matches = new Map<string, Set<string>>()
  const filter = (search: string, option: Option<string>): boolean => {
    if (!search)
      return true
    let results = matches.get(search)
    if (!results) {
      results = new Set(fuzzysort.go(search, targets, { keys: ['npm', 'name', 'category'] }).map(r => r.obj.value))
      matches.set(search, results)
    }
    return results.has(option.value)
  }

  const result = await autocompleteMultiselect({
    message,
    options: clackOptions,
    filter,
    required: false,
  })

  return isCancel(result)
    ? { selected: [], cancelled: true }
    : { selected: result, cancelled: false }
}
