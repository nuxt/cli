import { defineCommand } from 'citty'
import { provider } from 'std-env'
import nuxiPkg from '../package.json' assert { type: 'json' }
import { commands } from './commands'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'

export const main = defineCommand({
  meta: {
    name: nuxiPkg.name,
    version: nuxiPkg.version,
    description: nuxiPkg.description,
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
      ]).catch(err => console.error(err))
    }

    // Avoid background check to fix prompt issues
    if (command === 'init') {
      await backgroundTasks
    }
  },
}) as any /* TODO: Fix rollup type inline issue */
