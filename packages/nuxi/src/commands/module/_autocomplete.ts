import type { Option } from '@clack/prompts'
import type { NuxtModule } from './_utils'

import { autocompleteMultiselect, isCancel } from '@clack/prompts'
import { byLengthAsc, Fzf } from 'fzf'
import { hasTTY } from 'std-env'

import { logger } from '../../utils/logger'

interface AutocompleteOptions {
  modules: NuxtModule[]
  message?: string
}

interface AutocompleteResult {
  selected: string[]
  cancelled: boolean
}

/**
 * Interactive fuzzy search for selecting Nuxt modules
 * Returns object with selected module npm package names and cancellation status
 */
export async function selectModulesAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult> {
  const { modules, message = 'Search and select modules:' } = options

  if (!hasTTY) {
    logger.warn('Interactive module selection requires a TTY. Skipping.')
    return { selected: [], cancelled: false }
  }

  // Sort: official modules first, then alphabetically
  const sortedModules = [...modules].sort((a, b) => {
    if (a.type === 'official' && b.type !== 'official')
      return -1
    if (a.type !== 'official' && b.type === 'official')
      return 1
    return a.npm.localeCompare(b.npm)
  })

  // Setup fzf for fast fuzzy search
  const fzf = new Fzf(sortedModules, {
    selector: m => `${m.npm} ${m.name} ${m.category}`,
    casing: 'case-insensitive',
    tiebreakers: [byLengthAsc],
  })

  // Build options for clack multiselect
  const clackOptions: Option<string>[] = sortedModules.map(m => ({
    value: m.npm,
    label: m.npm,
    hint: m.description.replace(/\.$/, ''),
  }))

  // Custom filter function using fzf for fuzzy matching
  const filter = (search: string, option: Option<string>): boolean => {
    if (!search)
      return true
    const results = fzf.find(search)
    return results.some(r => r.item.npm === option.value)
  }

  const result = await autocompleteMultiselect({
    message,
    options: clackOptions,
    filter,
    required: false,
  })

  if (isCancel(result)) {
    return { selected: [], cancelled: true }
  }

  return { selected: result, cancelled: false }
}
