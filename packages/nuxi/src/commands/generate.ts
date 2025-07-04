import { defineCommand } from 'citty'

import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'
import buildCommand from './build'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Build Nuxt and prerender all routes',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    preset: {
      type: 'string',
      description: 'Nitro server preset',
    },
    ...dotEnvArgs,
    ...envNameArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    ctx.args.prerender = true
    await buildCommand.run!(
      // @ts-expect-error types do not match
      ctx,
    )
  },
})
