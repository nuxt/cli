import { defineCommand } from 'citty'
import { x } from 'tinyexec'

import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'devtools',
    description: 'Enable or disable devtools in a Nuxt project',
  },
  args: {
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

    if (command !== 'enable' && command !== 'disable') {
      throw new Error(`Unknown devtools command \`${command}\`. Expected \`enable\` or \`disable\`.`)
    }

    await x(
      'npx',
      ['--yes', '@nuxt/devtools-wizard@latest', command],
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
