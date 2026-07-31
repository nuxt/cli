import type { CommandDef } from 'citty'

import nodeCrypto from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { runMain as _runMain, defineCommand } from 'citty'
import { provider } from 'std-env'

import { cwdArgs } from '../../nuxt-cli/src/commands/_shared'
import { isNuxiCommand } from '../../nuxt-cli/src/commands/_utils'
import { setupGlobalConsole } from '../../nuxt-cli/src/utils/console'
import { checkEngines } from '../../nuxt-cli/src/utils/engines'
import { debug, logger } from '../../nuxt-cli/src/utils/logger'
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
  init: () => import('../../nuxt-cli/src/commands/init').then(m => m.default || m),
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

    // Check Node.js version in background
    let backgroundTasks: Promise<any> | undefined
    if (provider !== 'stackblitz') {
      backgroundTasks = Promise.all([
        checkEngines(),
      ]).catch(err => logger.error(String(err)))
    }

    // Avoid background check to fix prompt issues
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
      try {
        const { x } = await import('tinyexec')
        // `tinyexec` will resolve command from local binaries
        await x(`nuxt-${ctx.args.command}`, ctx.rawArgs.slice(1), {
          nodeOptions: { stdio: 'inherit', cwd },
          throwOnError: true,
        })
      }
      catch (err) {
        // TODO: use windows err code as well
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return
        }
      }
      process.exit()
    }
  },
})

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
