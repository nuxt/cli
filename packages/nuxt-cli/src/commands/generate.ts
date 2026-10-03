import { defineCommand } from 'citty'

import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, profileArgs, rootDirArgs, targetArgs } from './_shared'
import buildCommand from './build'
import { commandMeta } from './meta'

export default defineCommand({
  meta: commandMeta.generate,
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...targetArgs,
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
