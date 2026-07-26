import process from 'node:process'
import { defineCommand } from 'citty'

import { isTest } from 'std-env'
import { resolveRootDir } from '../utils/paths'

import { dotEnvArgs, envNameArgs, logLevelArgs, rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: '_dev',
    description: 'Run Nuxt development server (internal command to start child process)',
    hidden: true,
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...dotEnvArgs,
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
      negativeDescription: 'Disable clear console on restart',
    },
  },
  async run(ctx) {
    if (!process.send && !isTest) {
      console.warn('`nuxt _dev` is an internal command and should not be used directly. Please use `nuxt dev` instead.')
    }

    const cwd = resolveRootDir(ctx.args)

    const { initialize } = await import('../dev')
    await initialize({ cwd, args: ctx.args }, ctx)
  },
})
