export interface SuggestionPolicy {
  /** Minimum `fuzzysort` score for a subsequence match to be believed. */
  threshold: number
  /** How far ahead of the runner up a subsequence match has to be. */
  margin?: number
  /** Maximum number of edits between the input and a candidate. */
  tolerance?: (input: string) => number
  /** Whether a unique prefix of exactly one candidate is accepted outright. */
  prefix?: boolean
  /** Whether candidates tied on edit distance are rejected rather than picked between. */
  requireUnique?: boolean
}

/**
 * A wrong command suggestion replaces the help output the user would otherwise
 * have read, so it has to be right; a wrong flag suggestion sits next to the
 * flag they typed, so a lower bar is worth the extra hits.
 */
export const commandPolicy: SuggestionPolicy = {
  threshold: 0.6,
  margin: 0.1,
  tolerance: input => input.length <= 4 ? 1 : 2,
  prefix: true,
  requireUnique: true,
}

export const flagPolicy: SuggestionPolicy = {
  threshold: 0.3,
  tolerance: input => input.length <= 4 ? 1 : 2,
}

/**
 * Best guess at the candidate an input was meant to be, or `undefined` when
 * nothing is close enough to be worth printing.
 *
 * `fuzzysort` matches prefixes and subsequences well but scores transpositions
 * at zero (`biuld` against `build`, `dotnev` against `dotenv`), which is the
 * most common typo of all, so edit distance covers what it rejects.
 */
export async function suggestClosest(input: string, candidates: string[], policy: SuggestionPolicy): Promise<string | undefined> {
  const query = input.toLowerCase()
  if (!query || candidates.includes(input)) {
    return undefined
  }

  const lowerCased = candidates.map(candidate => candidate.toLowerCase())

  if (policy.prefix) {
    const prefixMatches = candidates.filter((_, index) => lowerCased[index]!.startsWith(query))
    if (prefixMatches.length === 1) {
      return prefixMatches[0]
    }
  }

  const { default: fuzzysort } = await import('fuzzysort')
  const [best, runnerUp] = fuzzysort.go(query, candidates, { threshold: policy.threshold })
  if (best && (!runnerUp || best.score - runnerUp.score >= (policy.margin ?? 0))) {
    return best.target
  }

  const tolerance = policy.tolerance?.(query) ?? 0
  if (tolerance <= 0) {
    return undefined
  }

  let closest: string | undefined
  let closestDistance = Number.POSITIVE_INFINITY
  let tied = false
  for (const [index, candidate] of lowerCased.entries()) {
    const distance = editDistance(query, candidate)
    if (distance < closestDistance) {
      closestDistance = distance
      closest = candidates[index]
      tied = false
    }
    else if (distance === closestDistance) {
      tied = true
    }
  }

  if (closestDistance > tolerance || (tied && policy.requireUnique)) {
    return undefined
  }
  return closest
}

/** Damerau-Levenshtein distance, so a single transposition counts as one edit. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 0; i <= a.length; i++) {
    rows[i]![0] = i
  }
  for (let j = 0; j <= b.length; j++) {
    rows[0]![j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + cost)
      }
    }
  }
  return rows[a.length]![b.length]!
}
