import process from 'node:process'
import { defineCommand } from 'citty'
import { isTest } from 'std-env'

import { cwdArgs, dotEnvArgs, envNameArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: '_dev',
    description: 'Run Nuxt development server (internal command to start child process)',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...dotEnvArgs,
    ...legacyRootDirArgs,
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
      negativeDescription: 'Disable clear console on restart',
    },
  },
  async run(ctx) {
    if (!process.send && !isTest) {
      console.warn('`nuxi _dev` is an internal command and should not be used directly. Please use `nuxi dev` instead.')
    }

    const { initialize } = await import('../dev')

    await initialize(ctx)
  },
})
