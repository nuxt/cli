import { defineCommand } from 'citty'
import { commands } from './commands'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'
import { checkForUpdates } from './utils/update'

export const main = defineCommand({
  meta: {
    name: 'nuxi-ng',
    description: 'Nuxt CLI (experimental)',
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

    // Avoid background check to fix prompt issues
    if (command === 'init') {
      await backgroundTasks
    }
  },
}) as any /* TODO: Fix rollup type inline issue */
