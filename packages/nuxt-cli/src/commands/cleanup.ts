import { defineCommand } from 'citty'

import { loadKit } from '../utils/kit'

import { logger } from '../utils/logger'
import { cleanupNuxtDirs } from '../utils/nuxt'
import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'
import { commandMeta } from './meta'

export default defineCommand({
  meta: commandMeta.cleanup,
  args: {
    ...rootDirArgs,
  },
  async run(ctx) {
    const cwd = resolveRootDir(ctx.args)
    const { loadNuxtConfig } = await loadKit(cwd)
    const nuxtOptions = await loadNuxtConfig({ cwd, overrides: { dev: true } })
    await cleanupNuxtDirs(nuxtOptions.rootDir, nuxtOptions.buildDir)

    logger.success('Cleanup complete!')
  },
})
