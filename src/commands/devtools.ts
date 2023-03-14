import { resolve } from 'pathe'
import { execa } from 'execa'
import { showUsage } from 'citty'
import { defineNuxtCommand } from './index'

export default defineNuxtCommand({
  meta: {
    name: 'devtools',
    description: 'Enable or disable features in a Nuxt project',
  },
  args: {
    enabled: {
      type: 'positional',
      description: 'Enable or disable features',
      valueHint: 'enable|disable',
    },
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
  },
  async run({ args, cmd }) {
    const [_ /* TODO */, command, _rootDir = '.'] = args._
    const rootDir = resolve(_rootDir)

    if (!['enable', 'disable'].includes(command)) {
      // TODO: Throw ESUBCOMMAND to trigger usage
      await showUsage(cmd)
      throw new Error(`Unknown command \`${command}\`!`)
    }

    // Defer to feature setup
    await execa('npx', ['@nuxt/devtools@latest', command, rootDir], {
      stdio: 'inherit',
      cwd: rootDir,
    })
  },
})
