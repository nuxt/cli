import type { CommandDef } from 'citty'

import nodeCrypto from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { runMain as _runMain, defineCommand } from 'citty'
import { provider } from 'std-env'

import { cwdArgs } from '../../nuxt-cli/src/commands/_shared'
import { isNuxiCommand, nuxiCommands } from '../../nuxt-cli/src/commands/_utils'
import { setupGlobalConsole } from '../../nuxt-cli/src/utils/console'
import { checkEngines } from '../../nuxt-cli/src/utils/engines'
import { debug, logger } from '../../nuxt-cli/src/utils/logger'
import { findInPath, withLocalBinPath } from '../../nuxt-cli/src/utils/path-env'
import { description, name, version } from '../package.json'

// globalThis.crypto support for Node.js 18
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto as unknown as Crypto
}

// Node.js below v22.3.0, v20.16.0
if (!process.getBuiltinModule) {
  const _require = createRequire(import.meta.url)
  // @ts-expect-error we are overriding with inferior types
  process.getBuiltinModule = (name: string) => {
    if (name.startsWith('node:') || builtinModules.includes(name)) {
      return _require.resolve(name)
    }
  }
}

const commands = {
  init: () => import('../../create-nuxt/src/init').then(m => m.default || m),
} as const

const _main = defineCommand({
  meta: {
    name: name.endsWith('nightly') ? name : 'nuxi',
    version,
    description,
  },
  args: {
    ...cwdArgs,
    command: {
      type: 'positional',
      required: false,
    },
  },
  subCommands: commands,
  async setup(ctx) {
    const command = ctx.args._[0]
    setupGlobalConsole({ dev: command === 'dev' })
    debug(`Running \`nuxt ${command}\` command`)

    let backgroundTasks: Promise<any> | undefined
    if (provider !== 'stackblitz') {
      backgroundTasks = Promise.all([
        checkEngines(),
      ]).catch(err => logger.error(String(err)))
    }

    // Awaited so the engine warning cannot land in the middle of a prompt.
    if (command === 'init') {
      await backgroundTasks
    }

    if (ctx.args.command && !(ctx.args.command in commands)) {
      if (isNuxiCommand(ctx.args.command)) {
        logger.error(`\`nuxt ${ctx.args.command}\` is provided by the \`@nuxt/cli\` installed with Nuxt in your project, and no usable version was found.`)
        logger.info(`Run this command from your Nuxt project directory, or install Nuxt first (for example with ${styleText('cyan', 'npx nuxi init')} or ${styleText('cyan', 'npm install nuxt')}).`)
        process.exit(1)
      }

      // allow running arbitrary commands if there's a locally registered binary with `nuxt-` prefix
      const cwd = resolve(ctx.args.cwd)
      const env = withLocalBinPath(cwd)
      // Resolved before spawning rather than after failing: Windows runs a bare
      // name through `cmd.exe`, which reports its own error instead of `ENOENT`,
      // so a missing binary would otherwise look like one that ran and failed.
      const binary = findInPath(`nuxt-${ctx.args.command}`, env)
      if (!binary) {
        return reportUnknownCommand(ctx.args.command)
      }
      const { x } = await import('tinyexec')
      // The resolved path is spawned rather than the bare name: `tinyexec` would
      // otherwise search `node_modules/.bin` relative to this process's directory,
      // which is not the directory the command was asked to run in.
      const result = await x(binary, ctx.rawArgs.slice(1), {
        nodeOptions: { stdio: 'inherit', cwd, env },
        nodePath: false,
        throwOnError: false,
      })
      process.exit(result.exitCode ?? 0)
    }
  },
})

async function reportUnknownCommand(command: string): Promise<void> {
  const { suggestCommand } = await import('../../nuxt-cli/src/utils/suggest-command')
  const suggestion = await suggestCommand(command, nuxiCommands.filter(name => !name.startsWith('_')))
  if (!suggestion) {
    return
  }

  logger.error(`Unknown command ${styleText('cyan', command)}. Did you mean ${styleText('cyan', `nuxt ${suggestion}`)}?`)
  logger.info(`Run ${styleText('cyan', 'nuxt --help')} to see all commands.`)
  process.exit(1)
}

export const main = _main as CommandDef<any>

/**
 * Run the commands bundled with `nuxi` itself, used when the project has no
 * `@nuxt/cli` or when its `@nuxt/cli` does not know the requested command.
 */
export async function runFallbackMain(): Promise<void> {
  if (process.argv[2] === 'complete') {
    const { initCompletions } = await import('../../nuxt-cli/src/completions')
    await initCompletions(main)
  }

  return _runMain(main)
}
