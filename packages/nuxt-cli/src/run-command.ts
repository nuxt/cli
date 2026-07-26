import type { ArgsDef, CommandDef } from 'citty'

import process from 'node:process'

import { runCommand as _runCommand } from 'citty'

import { isNuxiCommand } from './commands/_utils'
import { normaliseCwdArg } from './utils/args'

// To provide subcommands call it as `runCommandDef(<command>, [<subcommand>, ...])`
export async function runCommandDef<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
): Promise<{ result: unknown }> {
  if (command.meta && 'name' in command.meta && typeof command.meta.name === 'string') {
    const name = command.meta.name
    if (!(isNuxiCommand(name))) {
      throw new Error(`Invalid command ${name}`)
    }
  }
  else {
    throw new Error(`Invalid command, must be named`)
  }

  const rawArgs = [...argv]
  normaliseCwdArg(rawArgs)

  return await _runCommand(command, {
    rawArgs,
    data: {
      overrides: data.overrides || {},
    },
  })
}
