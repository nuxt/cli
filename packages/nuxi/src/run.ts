import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runCommand as _runCommand, runMain as _runMain } from 'citty'

import { commands } from './commands'
import { main } from './main'

globalThis.__nuxt_cli__ = globalThis.__nuxt_cli__ || {
  // Programmatic usage fallback
  startTime: Date.now(),
  entry: fileURLToPath(
    new URL('../../bin/nuxi.mjs', import.meta.url),
  ),
  devEntry: fileURLToPath(
    new URL('../dist/dev/index.mjs', import.meta.url),
  ),
}

export const runMain = () => _runMain(main)

// To provide subcommands call it as `runCommand(<command>, [<subcommand>, ...])`
export async function runCommand(
  name: string,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
) {
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
