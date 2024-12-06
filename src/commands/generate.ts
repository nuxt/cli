import { defineCommand } from 'citty'
import buildCommand from './build'

import { sharedArgs, envNameArgs, legacyRootDirArgs, dotEnvArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Build Nuxt and prerender all routes',
  },
  args: {
    ...sharedArgs,
    ...envNameArgs,
    ...legacyRootDirArgs,
    ...dotEnvArgs,
  },
  async run(ctx) {
    ctx.args.prerender = true
    await buildCommand.run!(ctx as any)
  },
})
