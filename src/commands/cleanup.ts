import { resolve } from 'pathe'
import { cleanupNuxtDirs } from '../utils/nuxt'
import { defineCommand } from 'citty'

import { sharedArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'cleanup',
    description: 'Cleanup generated nuxt files and caches',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')
    await cleanupNuxtDirs(cwd)
  },
})
