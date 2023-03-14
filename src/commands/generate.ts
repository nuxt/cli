import buildCommand from './build'
import { defineNuxtCommand } from './index'

export default defineNuxtCommand({
  meta: {
    name: 'generate',
    description: 'Build Nuxt and prerender static routes',
  },
  args: {
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
    dotenv: {
      type: 'boolean',
      description: 'Load dotenv file',
    },
  },
  async run({ args }) {
    args.prerender = true
    await buildCommand.invoke(args)
  },
})
