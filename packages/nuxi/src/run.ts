import { fileURLToPath } from 'node:url'

globalThis.__nuxt_cli__ = globalThis.__nuxt_cli__ || {
  // Programmatic usage fallback
  startTime: Date.now(),
  entry: fileURLToPath(
    new URL('../../bin/nuxi.mjs', import.meta.url),
  ),
}

// To provide subcommands call it as `runCommand(<command>, [<subcommand>, ...])`
export { runCommandDef as runCommand } from '../../nuxt-cli/src/run-command'
