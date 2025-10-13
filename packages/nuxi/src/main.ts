import nodeCrypto from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import { runMain as _runMain, defineCommand } from 'citty'
import { provider } from 'std-env'

import { description, name, version } from '../package.json'
import { commands } from './commands'
import { cwdArgs } from './commands/_shared'
import { initCompletions } from './completions'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'
import { logger } from './utils/logger'

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

export const main = defineCommand({
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
    logger.debug(`Running \`nuxt ${command}\` command`)
    const dev = command === 'dev'
    setupGlobalConsole({ dev })

    // Check Node.js version and CLI updates in background
    let backgroundTasks: Promise<any> | undefined
    if (command !== '_dev' && provider !== 'stackblitz') {
      backgroundTasks = Promise.all([
        checkEngines(),
      ]).catch(err => logger.error(err))
    }

    // Avoid background check to fix prompt issues
    if (command === 'init') {
      await backgroundTasks
    }

    // allow running arbitrary commands if there's a locally registered binary with `nuxt-` prefix
    if (ctx.args.command && !(ctx.args.command in commands)) {
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

export async function runMain() {
  await initCompletions(main)

  return _runMain(main)
}
