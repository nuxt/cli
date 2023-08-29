import { resolve } from 'pathe'
import { execa } from 'execa'
import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'devtools',
    description: 'Enable or disable devtools in a Nuxt project',
  },
  args: {
    ...sharedArgs,
    command: {
      type: 'positional',
      description: 'Command to run',
      valueHint: 'enable|disable',
    },
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    if (!['enable', 'disable'].includes(ctx.args.command)) {
      console.error(`Unknown command \`${ctx.args.command}\`.`)
      process.exit(1)
    }

    await execa(
      'npx',
      ['@nuxt/devtools-wizard@latest', ctx.args.command, cwd],
      {
        stdio: 'inherit',
        cwd,
      },
    )
  },
})
