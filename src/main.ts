import { resolve } from 'node:path'
import process from 'node:process'

import { defineCommand } from 'citty'
import { provider } from 'std-env'

import nuxiPkg from '../package.json' assert { type: 'json' }
import { commands } from './commands'
import { cwdArgs } from './commands/_shared'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'
import { logger } from './utils/logger'

export const main = defineCommand({
  meta: {
    name: nuxiPkg.name,
    version: nuxiPkg.version,
    description: nuxiPkg.description,
  },
  args: {
    ...cwdArgs,
    command: {
      type: 'positional',
    },
  },
  subCommands: commands,
  async setup(ctx) {
    const command = ctx.args._[0]
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
        await x(`nuxt-${ctx.args.command}`, ctx.args._.slice(1), {
          nodeOptions: { stdio: 'inherit', cwd },
          throwOnError: true,
        })
      }
      catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return
        }
      }
      process.exit()
    }
  },
})
