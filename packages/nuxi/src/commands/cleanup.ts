import { defineCommand } from 'citty'
import { resolve } from 'pathe'

import { loadKit } from '../utils/kit'
import { cleanupNuxtDirs } from '../utils/nuxt'
import { cwdArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'cleanup',
    description: 'Clean up generated Nuxt files and caches',
  },
  args: {
    ...cwdArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({ cwd, overrides: { dev: true } })
    await cleanupNuxtDirs(nuxtOptions.rootDir, nuxtOptions.buildDir)
  },
})
