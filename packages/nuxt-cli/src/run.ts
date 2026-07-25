import type { ArgsDef, CommandDef } from 'citty'

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runCommand as _runCommand, runMain as _runMain } from 'citty'

import { commands } from './commands'
import { isNuxiCommand } from './commands/_utils'
import { main } from './main'

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

export async function runMain(): Promise<void> {
  if (process.argv[2] === 'complete') {
    const { initCompletions } = await import('./completions')
    await initCompletions(main)
  }
  return _runMain(main)
}

export async function runCommand(
  name: string,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
): Promise<{ result: unknown }> {
  argv.push('--no-clear') // Dev

  if (!(name in commands)) {
    throw new Error(`Invalid command ${name}`)
  }

  return await _runCommand(await commands[name as keyof typeof commands](), {
    rawArgs: argv,
    data: {
      overrides: data.overrides || {},
    },
  })
}

// To provide subcommands call it as `runCommandDef(<command>, [<subcommand>, ...])`
export async function runCommandDef<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
): Promise<{ result: unknown }> {
  argv.push('--no-clear') // Dev
  if (command.meta && 'name' in command.meta && typeof command.meta.name === 'string') {
    const name = command.meta.name
    if (!(isNuxiCommand(name))) {
      throw new Error(`Invalid command ${name}`)
    }
  }
  else {
    throw new Error(`Invalid command, must be named`)
  }

  return await _runCommand(command, {
    rawArgs: argv,
    data: {
      overrides: data.overrides || {},
    },
  })
}
