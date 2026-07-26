import process from 'node:process'

import { defineCommand } from 'citty'

import colors from 'picocolors'
import { x } from 'tinyexec'
import { logger } from '../utils/logger'

import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'devtools',
    description: 'Enable or disable devtools in a Nuxt project',
  },
  args: {
    // `command` has to precede the `dir` positional supplied by `rootDirArgs`
    command: {
      type: 'positional',
      description: 'Command to run',
      valueHint: 'enable|disable',
    },
    ...rootDirArgs,
  },
  async run(ctx) {
    const cwd = resolveRootDir(ctx.args)
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
