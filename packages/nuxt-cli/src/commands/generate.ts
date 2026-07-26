import { defineCommand } from 'citty'

import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, profileArgs, rootDirArgs } from './_shared'
import buildCommand from './build'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Build Nuxt and prerender all routes',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    preset: {
      type: 'string',
      description: 'Nitro server preset',
    },
    ...dotEnvArgs,
    ...envNameArgs,
    ...extendsArgs,
    ...profileArgs,
  },
  async run(ctx) {
    ctx.args.prerender = true
    await buildCommand.run!(
      // @ts-expect-error types do not match
      ctx,
    )
  },
})
