import { resolve } from 'pathe'
import { cleanupNuxtDirs } from '../utils/nuxt'
import { defineCommand } from 'citty'

import { sharedArgs, legacyRootDirArgs } from './_shared'
import { loadKit } from '../utils/kit'

export default defineCommand({
  meta: {
    name: 'cleanup',
    description: 'Clean up generated Nuxt files and caches',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({ cwd })
    await cleanupNuxtDirs(nuxtOptions.rootDir, nuxtOptions.buildDir)
  },
})
