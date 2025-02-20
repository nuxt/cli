import { defineCommand, showUsage } from 'citty'
import { provider } from 'std-env'

import init from '../../nuxi/src/commands/init'
import { setupGlobalConsole } from '../../nuxi/src/utils/console'
import { checkEngines } from '../../nuxi/src/utils/engines'
import { logger } from '../../nuxi/src/utils/logger'
import { description, name, version } from '../package.json'

export const main = defineCommand({
  meta: {
    name,
    version,
    description,
  },
  args: init.args,
  async setup(ctx) {
    setupGlobalConsole({ dev: false })

    // Check Node.js version and CLI updates in background
    if (provider !== 'stackblitz') {
      await checkEngines().catch(err => logger.error(err))
    }

    await init.run?.(ctx)
  },
})
