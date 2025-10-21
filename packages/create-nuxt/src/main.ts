import type { CommandDef } from 'citty'
import { defineCommand } from 'citty'
import { provider } from 'std-env'

import init from '../../nuxi/src/commands/init'
import { setupInitCompletions } from '../../nuxi/src/completions-init'
import { setupGlobalConsole } from '../../nuxi/src/utils/console'
import { checkEngines } from '../../nuxi/src/utils/engines'
import { logger } from '../../nuxi/src/utils/logger'
import { description, name, version } from '../package.json'

const _main = defineCommand({
  meta: {
    name,
    version,
    description,
  },
  args: init.args,
  async setup(ctx) {
    const isCompletionRequest = ctx.args._?.[0] === 'complete'
    if (isCompletionRequest) {
      return
    }

    setupGlobalConsole({ dev: false })

    // Check Node.js version and CLI updates in background
    if (provider !== 'stackblitz') {
      await checkEngines().catch(err => logger.error(err))
    }

    await init.run?.(ctx)
  },
})

await setupInitCompletions(_main)

export const main = _main as CommandDef<any>
