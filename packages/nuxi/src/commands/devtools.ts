import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { logger } from '../utils/logger'
import { cwdArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'devtools',
    description: 'Enable or disable devtools in a Nuxt project',
  },
  args: {
    ...cwdArgs,
    command: {
      type: 'positional',
      description: 'Command to run',
      valueHint: 'enable|disable',
    },
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const command = ctx.args.command

    if (!command || !['enable', 'disable'].includes(command)) {
      logger.error(`Unknown command ${colors.cyan(command || '')}.`)
      process.exit(1)
    }

    await x(
      'npx',
      ['@nuxt/devtools-wizard@latest', command, cwd],
      {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      },
    )
  },
})
