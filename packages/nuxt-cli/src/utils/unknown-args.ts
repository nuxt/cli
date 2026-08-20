import type { ArgsDef } from 'citty'

import { flagPolicy, suggestClosest } from './suggest'

/** Always accepted by citty, so never reported as unknown. */
const BUILTIN_FLAGS = ['help', 'version']

const LEADING_DASHES_RE = /^--/
const NEGATION_RE = /^no-/

export interface UnknownFlags {
  flags: string[]
  known: string[]
}

/**
 * Long flags in `rawArgs` that `argsDef` does not declare.
 *
 * Only `--long` forms are considered. A bundle of short flags (`-abc`) cannot be
 * told apart from a single misspelled one, and guessing wrong is worse than
 * staying quiet.
 */
export function findUnknownFlags(argsDef: ArgsDef, rawArgs: string[]): UnknownFlags {
  const known = new Set<string>(BUILTIN_FLAGS)
  for (const [name, def] of Object.entries(argsDef)) {
    known.add(name)
    const alias = (def as { alias?: string | string[] }).alias
    for (const entry of Array.isArray(alias) ? alias : alias ? [alias] : []) {
      known.add(entry)
    }
  }

  const separator = rawArgs.indexOf('--')
  const argv = separator === -1 ? rawArgs : rawArgs.slice(0, separator)

  const flags: string[] = []
  for (const arg of argv) {
    if (!arg.startsWith('--') || arg === '--') {
      continue
    }
    const equals = arg.indexOf('=')
    const name = (equals === -1 ? arg : arg.slice(0, equals)).replace(LEADING_DASHES_RE, '')
    if (name && !isKnown(known, name) && !flags.includes(name)) {
      flags.push(name)
    }
  }
  return { flags, known: [...known] }
}

/**
 * The declared flag each unknown flag was most likely meant to be. Resolved
 * separately so the fuzzy matcher is only loaded once something is wrong.
 */
export async function suggestFlags({ flags, known }: UnknownFlags): Promise<Array<{ flag: string, suggestion?: string }>> {
  return Promise.all(flags.map(async (flag) => {
    const match = await suggestClosest(flag.replace(NEGATION_RE, ''), known, flagPolicy)
    return { flag: `--${flag}`, suggestion: match && `--${match}` }
  }))
}

/**
 * Rewrite every use of `--flag` (bare or `=value`) to `replacement`, in place:
 * citty re-reads the same array when it resolves the subcommand, so an in-place
 * edit is what makes the correction reach the command that runs.
 */
export function replaceFlag(rawArgs: string[], flag: string, replacement: string): void {
  const separator = rawArgs.indexOf('--')
  const end = separator === -1 ? rawArgs.length : separator
  for (let i = 0; i < end; i++) {
    if (rawArgs[i] === flag) {
      rawArgs[i] = replacement
    }
    else if (rawArgs[i]!.startsWith(`${flag}=`)) {
      rawArgs[i] = `${replacement}${rawArgs[i]!.slice(flag.length)}`
    }
  }
}

/**
 * Dotted flags are declared either whole (`https.cert`) or as the object that
 * holds them (`https`), and a boolean may be negated with a `no-` prefix.
 */
function isKnown(known: Set<string>, name: string): boolean {
  for (const candidate of new Set([name, name.replace(NEGATION_RE, '')])) {
    if (known.has(candidate)) {
      return true
    }
    for (let dot = candidate.lastIndexOf('.'); dot !== -1; dot = candidate.lastIndexOf('.', dot - 1)) {
      if (known.has(candidate.slice(0, dot))) {
        return true
      }
    }
  }
  return false
}
