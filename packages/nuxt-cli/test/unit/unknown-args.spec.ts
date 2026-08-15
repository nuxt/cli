import type { ArgsDef, CommandDef } from 'citty'

import { describe, expect, it } from 'vitest'

import { commands } from '../../src/commands'
import { cwdArgs } from '../../src/commands/_shared'
import { findUnknownFlags, suggestFlags } from '../../src/utils/unknown-args'

const argsDef = {
  'cwd': { type: 'string' },
  'json': { type: 'boolean' },
  'logLevel': { type: 'string' },
  'fork': { type: 'boolean' },
  'https': { type: 'boolean' },
  'dotenv': { type: 'string' },
  'strictPort': { type: 'boolean' },
  'open.url': { type: 'string' },
  'port': { type: 'string', alias: ['p'] },
} satisfies ArgsDef

describe('findUnknownFlags', () => {
  it('should accept declared flags, aliases and negations', () => {
    const { flags } = findUnknownFlags(argsDef, ['--cwd=.', '--json', '--no-fork', '--port', '3000', '--help', '--version'])
    expect(flags).toEqual([])
  })

  it('should accept a dotted flag declared whole or by its parent', () => {
    expect(findUnknownFlags(argsDef, ['--open.url=/admin', '--https.cert=x', '--https.key', 'y']).flags).toEqual([])
  })

  it('should report a flag that is not declared', () => {
    expect(findUnknownFlags(argsDef, ['--strictport']).flags).toEqual(['strictport'])
  })

  it('should report each unknown flag once', () => {
    expect(findUnknownFlags(argsDef, ['--nope', '--nope=1']).flags).toEqual(['nope'])
  })

  it('should ignore short flags and everything after a separator', () => {
    expect(findUnknownFlags(argsDef, ['-abc', '-x', '--', '--nope']).flags).toEqual([])
  })

  it('should ignore positionals and a bare separator', () => {
    expect(findUnknownFlags(argsDef, ['build', './app', '--']).flags).toEqual([])
  })
})

describe('suggestFlags', () => {
  it('should suggest the declared flag a misspelling is closest to', async () => {
    await expect(suggestFlags(findUnknownFlags(argsDef, ['--loglevel', '--jsn']))).resolves.toEqual([
      { flag: '--loglevel', suggestion: '--logLevel' },
      { flag: '--jsn', suggestion: '--json' },
    ])
  })

  it('should suggest through a transposition', async () => {
    await expect(suggestFlags(findUnknownFlags(argsDef, ['--dotnev', '--strcitPort']))).resolves.toEqual([
      { flag: '--dotnev', suggestion: '--dotenv' },
      { flag: '--strcitPort', suggestion: '--strictPort' },
    ])
  })

  it('should not invent a suggestion for an unrelated flag', async () => {
    await expect(suggestFlags(findUnknownFlags(argsDef, ['--xyzzy']))).resolves.toEqual([{ flag: '--xyzzy', suggestion: undefined }])
  })
})

describe('declared command arguments', () => {
  it('should never be reported as unknown', async () => {
    const reported: Record<string, string[]> = {}

    for (const name of Object.keys(commands)) {
      for (const [commandName, def] of await resolveCommands(name)) {
        const args = await resolveLazy((def as CommandDef<any>).args) ?? {}
        const argv: string[] = []
        for (const [flag, definition] of Object.entries(args as ArgsDef)) {
          if ((definition as { type?: string }).type === 'positional') {
            continue
          }
          argv.push(`--${flag}`)
        }
        const { flags } = findUnknownFlags({ ...cwdArgs, ...args }, argv)
        if (flags.length > 0) {
          reported[commandName] = flags
        }
      }
    }

    expect(reported).toEqual({})
  })
})

async function resolveCommands(name: string): Promise<Array<[string, unknown]>> {
  const def = await commands[name as keyof typeof commands]() as CommandDef<any>
  const subCommands = await resolveLazy(def.subCommands)
  if (!subCommands) {
    return [[name, def]]
  }
  return Promise.all(Object.entries(subCommands).map(async ([subName, subDef]) => [`${name} ${subName}`, await resolveLazy(subDef)] as [string, unknown]))
}

function resolveLazy<T>(value: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  return Promise.resolve(typeof value === 'function' ? (value as () => T | Promise<T>)() : value)
}
