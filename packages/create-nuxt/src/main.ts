import type { CommandDef } from 'citty'
import process from 'node:process'
import { defineCommand } from 'citty'
import { provider } from 'std-env'

import { checkEngines } from '../../nuxt-cli/src/utils/engines'
import { getCreateCommand, isPinnedCreateInvocation } from '../../nuxt-cli/src/utils/headless'
import { debug, logger } from '../../nuxt-cli/src/utils/logger'
import { scheduleSelfUpdateNudge } from '../../nuxt-cli/src/utils/update-check'
import { description, name, version } from '../package.json'
import { setupInitCompletions } from './completions'
import init from './init'

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

    if (provider !== 'stackblitz') {
      // The engine check is awaited so its warning cannot land in the middle of
      // a prompt, but the update check is left running: it reaches the user
      // through a `process.exit` handler, and a slow or unreachable registry
      // must never hold up scaffolding.
      await checkEngines().catch(err => logger.error(String(err)))
      void scheduleSelfUpdateNudge(name, version, {
        name,
        command: getCreateCommand(),
        shouldNudge: () => !isPinnedCreateInvocation(),
      }).catch(err => debug('Failed to check for updates:', err))
    }

    await init.run?.(ctx)
  },
})

if (process.argv[2] === 'complete') {
  // eslint-disable-next-line antfu/no-top-level-await
  await setupInitCompletions(_main)
}

export const main = _main as CommandDef<any>
