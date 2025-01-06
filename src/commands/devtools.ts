import { resolve } from 'pathe'
import { x } from 'tinyexec'
import { defineCommand } from 'citty'

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

    if (!['enable', 'disable'].includes(ctx.args.command)) {
      console.error(`Unknown command \`${ctx.args.command}\`.`)
      process.exit(1)
    }

    await x(
      'npx',
      ['@nuxt/devtools-wizard@latest', ctx.args.command, cwd],
      {
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      },
    )
  },
})
