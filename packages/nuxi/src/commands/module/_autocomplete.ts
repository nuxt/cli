import type { Choice } from '@posva/prompts'
import type { NuxtModule } from './_utils'

import process from 'node:process'
import prompts from '@posva/prompts'
import { colors } from 'consola/utils'
import { byLengthAsc, Fzf } from 'fzf'
import { hasTTY } from 'std-env'

import { logger } from '../../utils/logger'

export interface AutocompleteOptions {
  modules: NuxtModule[]
  message?: string
}

export interface AutocompleteResult {
  selected: string[]
  cancelled: boolean
}

/**
 * Interactive fuzzy search for selecting Nuxt modules
 * Returns object with selected module npm package names and cancellation status
 */
export async function selectModulesAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult> {
  const { modules, message = 'Search modules (Esc to finish):' } = options

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

  // Truncate description to fit terminal
  const terminalWidth = process.stdout?.columns || 80
  const maxDescLength = Math.max(40, terminalWidth - 35)
  const truncate = (str: string, max: number) =>
    str.length > max ? `${str.slice(0, max - 1)}…` : str

  // Track selected modules
  const selectedModules = new Set<string>()

  // Build choices with checkbox prefix
  const buildChoices = () => sortedModules.map((m) => {
    const isSelected = selectedModules.has(m.npm)
    const check = isSelected ? colors.green('✔') : colors.dim('○')
    return {
      title: `${check} ${m.npm}`,
      value: m.npm,
      description: truncate(m.description.replace(/\.$/, ''), maxDescLength),
    }
  })

  // Loop for multi-select via autocomplete with checkboxes
  let isExited = false
  let isDone = false
  let lastQuery = ''

  // ANSI escapes for terminal control
  const clearLines = (n: number) => {
    if (!hasTTY)
      return
    for (let i = 0; i < n; i++) {
      process.stdout.write('\x1B[1A\x1B[2K')
    }
  }

  // Show summary line
  const showSummary = () => {
    if (!hasTTY || selectedModules.size === 0)
      return
    const names = Array.from(selectedModules).map(m => colors.cyan(m.replace(/^@nuxt(js)?\//, ''))).join(', ')
    process.stdout.write(`${colors.dim('Selected:')} ${names}\n`)
  }

  while (!isDone) {
    const choices = buildChoices()

    // Clear previous prompt and show fresh summary
    if (lastQuery !== '' || selectedModules.size > 0) {
      clearLines(selectedModules.size > 0 ? 2 : 1)
    }
    showSummary()

    try {
      const result = await prompts({
        type: 'autocomplete',
        name: 'module',
        message,
        initial: lastQuery,
        choices,
        limit: 10,
        suggest: async (input: string, choices: Choice[]) => {
          lastQuery = input
          if (!input)
            return choices
          const results = fzf.find(input)
          return results.map((r) => {
            const isSelected = selectedModules.has(r.item.npm)
            const check = isSelected ? colors.green('✔') : colors.dim('○')
            return {
              title: `${check} ${r.item.npm}`,
              value: r.item.npm,
              description: truncate(r.item.description.replace(/\.$/, ''), maxDescLength),
            }
          })
        },
        onState(state: { exited?: boolean }) {
          if (state.exited)
            isExited = true
        },
      })

      if (isExited || !result.module) {
        isDone = true
      }
      else {
        // Toggle selection
        if (selectedModules.has(result.module)) {
          selectedModules.delete(result.module)
        }
        else {
          selectedModules.add(result.module)
        }
      }
      isExited = false
    }
    catch {
      isDone = true
    }
  }

  return { selected: Array.from(selectedModules), cancelled: false }
}
