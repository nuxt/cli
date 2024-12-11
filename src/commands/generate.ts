import { defineCommand } from 'citty'
import buildCommand from './build'

import { envNameArgs, legacyRootDirArgs, dotEnvArgs, cwdArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Build Nuxt and prerender all routes',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...legacyRootDirArgs,
    ...dotEnvArgs,
  },
  async run(ctx) {
    ctx.args.prerender = true
    await buildCommand.run!(ctx as any)
  },
})
