import type { CommandDef } from 'citty'
import process from 'node:process'
import { defineCommand } from 'citty'
import { provider } from 'std-env'

import init from '../../nuxi/src/commands/init'
import { setupInitCompletions } from '../../nuxi/src/completions-init'
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

    // Check Node.js version and CLI updates in background
    if (provider !== 'stackblitz') {
      await checkEngines().catch(err => logger.error(err))
    }

    await init.run?.(ctx)
  },
})

if (process.argv[2] === 'complete') {
  // eslint-disable-next-line antfu/no-top-level-await
  await setupInitCompletions(_main)
}

export const main = _main as CommandDef<any>
