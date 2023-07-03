import { defineCommand } from 'citty'
import { commands } from './commands'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'
import { checkForUpdates } from './utils/update'

export const main = defineCommand({
  meta: {
    name: 'nuxt',
  },
  subCommands: commands,
  setup: async (ctx) => {
    const command = ctx.args._[0]
    const dev = command === 'dev'
    setupGlobalConsole({ dev })

    // Check Node.js version and CLI updates in background
    const backgroundTasks = Promise.all([
      checkEngines(),
      checkForUpdates(),
    ]).catch((err) => console.error(err))
    if (command === 'init') {
      await backgroundTasks
    }
  },
}) as any /* TODO: Fix rollup type inline issue */
