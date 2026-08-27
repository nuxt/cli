import type { ArgsDef } from 'citty'

import process from 'node:process'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { commands } from '../../../src/commands'
import { suggestCommand } from '../../../src/utils/suggest-command'
import { findUnknownFlags, replaceFlag, suggestFlags } from '../../../src/utils/unknown-args'

const RUNS = Number(process.env.NUXT_CLI_FUZZ_RUNS) || 200

const names = Object.keys(commands).filter(name => !name.startsWith('_'))

const argsDef = {
  'cwd': { type: 'string' },
  'logLevel': { type: 'string' },
  'dotenv': { type: 'string' },
  'port': { type: 'string', alias: ['p', 'P'] },
  'host': { type: 'string' },
  'fork': { type: 'boolean' },
  'clear': { type: 'boolean' },
  'https': { type: 'boolean' },
  'https.cert': { type: 'string' },
  'open.url': { type: 'string' },
  'qr': { type: 'boolean' },
} satisfies ArgsDef

const declared = Object.keys(argsDef)
const aliases = ['p', 'P']

/** One typo of the kind a suggestion is meant to catch. */
function mutate(word: string, kind: 'delete' | 'transpose' | 'substitute' | 'insert', at: number): string {
  const index = word.length ? at % word.length : 0
  switch (kind) {
    case 'delete':
      return word.slice(0, index) + word.slice(index + 1)
    case 'transpose':
      return index + 1 >= word.length
        ? word
        : word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2)
    case 'substitute':
      return `${word.slice(0, index)}x${word.slice(index + 1)}`
    case 'insert':
      return `${word.slice(0, index)}q${word.slice(index)}`
  }
}

const mutation = fc.record({
  kind: fc.constantFrom<'delete' | 'transpose' | 'substitute' | 'insert'>('delete', 'transpose', 'substitute', 'insert'),
  at: fc.nat({ max: 20 }),
})

const word = fc.stringMatching(/^[a-z][a-z-]{0,12}$/)

describe('suggestCommand', () => {
  it('should only ever suggest a command that exists', async () => {
    await fc.assert(fc.asyncProperty(word, async (input) => {
      const suggestion = await suggestCommand(input, names)
      fc.pre(suggestion !== undefined)

      expect(names, input).toContain(suggestion)
    }), { numRuns: RUNS })
  })

  it('should stay quiet for a command spelled correctly', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...names), async (name) => {
      await expect(suggestCommand(name, names)).resolves.toBeUndefined()
    }), { numRuns: Math.min(RUNS, names.length * 2) })
  })

  it('should never point a typo at the wrong command', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...names), mutation, async (name, { kind, at }) => {
      const typo = mutate(name, kind, at)
      fc.pre(typo !== name && !names.includes(typo))
      // The typo has to be closer to its own command than to any other, or there
      // is no right answer to hold the matcher to.
      fc.pre(!names.some(other => other !== name && (other.startsWith(typo) || typo.startsWith(other))))

      const suggestion = await suggestCommand(typo, names)

      expect(suggestion === undefined || suggestion === name, `${typo} (from ${name}) suggested ${suggestion}`).toBe(true)
    }), { numRuns: RUNS })
  })

  it('should suggest the command a single transposition came from', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...names), fc.nat({ max: 20 }), async (name, at) => {
      const typo = mutate(name, 'transpose', at)
      fc.pre(typo !== name && !names.includes(typo))

      await expect(suggestCommand(typo, names), typo).resolves.toBe(name)
    }), { numRuns: RUNS })
  })

  it('should be indifferent to the order the commands are listed in', async () => {
    await fc.assert(fc.asyncProperty(word, fc.nat(), async (input, seed) => {
      const shuffled = [...names].sort((a, b) => ((seed + a.length) % 3) - ((seed + b.length) % 3) || a.localeCompare(b))

      await expect(suggestCommand(input, shuffled)).resolves.toBe(await suggestCommand(input, names))
    }), { numRuns: RUNS })
  })
})

const flagArgs = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...declared).map(name => `--${name}`) },
    { weight: 1, arbitrary: fc.constantFrom(...declared).map(name => `--${name}=value`) },
    { weight: 1, arbitrary: fc.constantFrom(...aliases).map(alias => `-${alias}`) },
    { weight: 1, arbitrary: fc.constantFrom('--help', '--version', '--no-fork', '--no-clear', '--https.key=x', '--open.target=x') },
    { weight: 3, arbitrary: word.map(name => `--${name}`) },
    { weight: 1, arbitrary: word },
    { weight: 1, arbitrary: fc.constantFrom('--', '-abc', '-', '3000', '--=x') },
  ),
  { maxLength: 8 },
)

describe('findUnknownFlags', () => {
  it('should never report a declared flag, alias or negation', () => {
    fc.assert(fc.property(flagArgs, (rawArgs) => {
      const { flags } = findUnknownFlags(argsDef, rawArgs)

      for (const flag of flags) {
        expect(declared, rawArgs.join(' ')).not.toContain(flag)
        expect(declared, rawArgs.join(' ')).not.toContain(flag.replace(/^no-/, ''))
      }
    }), { numRuns: RUNS })
  })

  it('should report each unknown flag once, in the order it was typed', () => {
    fc.assert(fc.property(flagArgs, (rawArgs) => {
      const { flags } = findUnknownFlags(argsDef, rawArgs)

      expect(flags).toEqual([...new Set(flags)])
      expect(flags.every(flag => rawArgs.some(arg => arg === `--${flag}` || arg.startsWith(`--${flag}=`)))).toBe(true)
    }), { numRuns: RUNS })
  })

  it('should ignore everything after a `--` separator', () => {
    fc.assert(fc.property(flagArgs, flagArgs, (before, after) => {
      const withSeparator = findUnknownFlags(argsDef, [...before, '--', ...after]).flags

      expect(withSeparator).toEqual(findUnknownFlags(argsDef, [...before, '--']).flags)
    }), { numRuns: RUNS })
  })

  it('should accept a dotted flag whose parent is declared', () => {
    fc.assert(fc.property(word, fc.array(word, { minLength: 1, maxLength: 3 }), (child, rest) => {
      expect(findUnknownFlags(argsDef, [`--https.${[child, ...rest].join('.')}=x`]).flags).toEqual([])
    }), { numRuns: RUNS })
  })

  it('should report nothing once a suggestion has been applied', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...declared), mutation, async (name, { kind, at }) => {
      const typo = mutate(name, kind, at)
      fc.pre(typo !== name)
      const rawArgs = [`--${typo}=value`, 'positional', `--${typo}`]

      const unknown = findUnknownFlags(argsDef, rawArgs)
      fc.pre(unknown.flags.length === 1)
      const [entry] = await suggestFlags(unknown)
      fc.pre(entry?.suggestion !== undefined)

      replaceFlag(rawArgs, entry.flag, entry.suggestion)

      expect(findUnknownFlags(argsDef, rawArgs).flags, rawArgs.join(' ')).toEqual([])
      expect(rawArgs).toHaveLength(3)
      expect(rawArgs[1]).toBe('positional')
    }), { numRuns: RUNS })
  })

  it('should only suggest flags the command declares', async () => {
    await fc.assert(fc.asyncProperty(flagArgs, async (rawArgs) => {
      const unknown = findUnknownFlags(argsDef, rawArgs)

      for (const { suggestion } of await suggestFlags(unknown)) {
        fc.pre(suggestion !== undefined)
        expect(unknown.known.map(name => `--${name}`)).toContain(suggestion)
      }
    }), { numRuns: RUNS })
  })

  it('should leave arguments after the separator alone when replacing', () => {
    fc.assert(fc.property(word, word, (flag, replacement) => {
      const rawArgs = [`--${flag}`, '--', `--${flag}`]

      replaceFlag(rawArgs, `--${flag}`, `--${replacement}`)

      expect(rawArgs[0]).toBe(`--${replacement}`)
      expect(rawArgs[2]).toBe(`--${flag}`)
    }), { numRuns: RUNS })
  })
})
