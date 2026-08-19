import process from 'node:process'
import { defineCommand } from 'citty'
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
    const cwd = resolveRootDir(ctx.args)
    const listenOverrides = process.env._PORT
      ? { port: process.env._PORT, hostname: '127.0.0.1', showURL: false, strictPort: true } as const
      : undefined

    const { initialize } = await import('../dev')
    await initialize({ cwd, args: ctx.args }, { data: ctx.data, listenOverrides })
  },
})
