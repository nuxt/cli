import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runCommand as _runCommand, runMain as _runMain } from 'citty'

import { commands } from './commands'
import { globalCwdArgs } from './commands/_shared'
import { main } from './main'
import { warnOnHang } from './utils/hang'

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

// Commands that keep serving after their `run` resolves, so an alive process is expected.
export const LONG_RUNNING_COMMANDS: Set<string> = new Set(['dev', '_dev', 'analyze', 'test'])

let currentCommand: string | undefined

/** Record the command being run, so `runMain` knows whether the process is expected to exit. */
export function setCurrentCommand(command: string | undefined): void {
  currentCommand = command
}

export async function runMain(): Promise<void> {
  if (process.argv[2] === 'complete') {
    const { initCompletions } = await import('./completions')
    await initCompletions(main)
  }
  await _runMain(main)

  if (!currentCommand || !LONG_RUNNING_COMMANDS.has(currentCommand)) {
    warnOnHang({ action: currentCommand ? `\`nuxt ${currentCommand}\`` : 'command' })
  }
}

export async function runCommand(
  name: string,
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
): Promise<{ result: unknown }> {
  if (!Object.hasOwn(commands, name)) {
    throw new Error(`Invalid command ${name}`)
  }

  return await _runCommand(await commands[name as keyof typeof commands](), {
    rawArgs: [...argv],
    inheritedArgs: globalCwdArgs,
    data: {
      overrides: data.overrides || {},
    },
  })
}
