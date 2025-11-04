import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runCommand as _runCommand, runMain as _runMain } from 'citty'

import init from '../../nuxi/src/commands/init'
import { main } from './main'

globalThis.__nuxt_cli__ = globalThis.__nuxt_cli__ || {
  // Programmatic usage fallback
  startTime: Date.now(),
  entry: fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts')
        ? '../bin/nuxi.mjs'
        : '../../bin/nuxi.mjs',
      import.meta.url,
    ),
  ),
}

export const runMain = (): Promise<void> => _runMain(main)

export async function runCommand(
  name: 'init',
  argv: string[] = process.argv.slice(2),
  data: { overrides?: Record<string, any> } = {},
): Promise<{ result: unknown }> {
  return await _runCommand(init, {
    rawArgs: argv,
    data: {
      overrides: data.overrides || {},
    },
  })
}
