import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runCommand as _runCommand, ArgsDef, CommandDef } from 'citty'

import { isNuxiCommand } from './commands/_utils'

globalThis.__nuxt_cli__ = globalThis.__nuxt_cli__ || {
  // Programmatic usage fallback
  startTime: Date.now(),
  entry: fileURLToPath(
    new URL('../../bin/nuxi.mjs', import.meta.url),
  ),
  devEntry: fileURLToPath(
    new URL('../dev/index.mjs', import.meta.url),
  ),
}

// To provide subcommands call it as `runCommand(<command>, [<subcommand>, ...])`
export async function runCommand<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
) {
  argv.push('--no-clear') // Dev
  if (command.meta && "name" in command.meta && typeof command.meta.name === 'string') {
    const name = command.meta.name
    if (!(isNuxiCommand(name))) {
      throw new Error(`Invalid command ${name}`)
    }
  } else {
    throw new Error(`Invalid command, must be named`)
  }

  return await _runCommand(command, {
    rawArgs: argv,
    data: {
      overrides: data.overrides || {},
    },
  })
}
