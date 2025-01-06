import { defineCommand } from 'citty'

import { cwdArgs, dotEnvArgs, envNameArgs, legacyRootDirArgs, logLevelArgs } from './_shared'
import buildCommand from './build'

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
