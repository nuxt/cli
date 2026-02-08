import type { CommandDef } from 'citty'
import { resolve } from 'node:path'
import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { provider } from 'std-env'

import { commands } from '../../nuxi/src/commands'
import { cwdArgs } from '../../nuxi/src/commands/_shared'
import { setupGlobalConsole } from '../../nuxi/src/utils/console'
import { checkEngines } from '../../nuxi/src/utils/engines'
import { logger } from '../../nuxi/src/utils/logger'
import { templateNames } from '../../nuxi/src/utils/templates'

import { description, name, version } from '../package.json'
import { runCommand } from './run'

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

    // Check Node.js version and CLI updates in background
    let backgroundTasks: Promise<any> | undefined
    if (command !== '_dev' && provider !== 'stackblitz') {
      backgroundTasks = Promise.all([
        checkEngines(),
      ]).catch(err => logger.error(String(err)))
    }

    // Avoid background check to fix prompt issues
    if (command === 'init') {
      await backgroundTasks
    }

    if (command === 'add' && ctx.rawArgs[1] && templateNames.includes(ctx.rawArgs[1])) {
      logger.warn(`${colors.yellow('Deprecated:')} Using ${colors.cyan('nuxt add <template> <name>')} is deprecated.`)
      logger.info(`Please use ${colors.cyan('nuxt add-template <template> <name>')} instead.`)
      await runCommand('add-template', [...ctx.rawArgs.slice(1)]).catch((err) => {
        console.error(err.message)
        process.exit(1)
      })
      process.exit(0)
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

export const main = _main as CommandDef<any>
