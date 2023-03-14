import { resolve } from 'pathe'
import { cleanupNuxtDirs } from '../utils/nuxt'
import { defineNuxtCommand } from './index'

export default defineNuxtCommand({
  meta: {
    name: 'cleanup',
    description: 'Cleanup generated nuxt files and caches',
  },
  args: {
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
  },
  async run({ args }) {
    const rootDir = resolve(args._[0] || '.')
    await cleanupNuxtDirs(rootDir)
  },
})
