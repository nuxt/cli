import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { readActiveLock } from '../utils/lockfile'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'prepare',
    description: 'Prepare Nuxt for development/build',
  },
  args: {
    ...dotEnvArgs,
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      cwd,
      dotenv: {
        cwd,
        fileName: ctx.args.dotenv,
      },
      envName: ctx.args.envName, // c12 will fall back to NODE_ENV
      overrides: {
        _prepare: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        ...(ctx.args.extends && { extends: ctx.args.extends }),
        ...ctx.data?.overrides,
      },
    })

    // Only wipe when nothing owns the buildDir. `clearBuildDir` removes the
    // generated artifacts a live dev server's watcher reloads against, so it
    // would resolve a freshly-deleted file (ENOENT); wiping under a build is
    // equally destructive. `buildNuxt` refreshes every template in place anyway,
    // so reuse is safe. Stop the owner if a clean wipe is genuinely needed.
    const owner = readActiveLock(nuxt.options.buildDir)
    if (owner) {
      const label = owner.command === 'dev' ? 'dev server' : 'build'
      logger.info(`A ${label} (PID ${owner.pid}) owns ${colors.cyan(relativeToProcess(nuxt.options.buildDir))}; refreshing templates in place without clearing.`)
    }
    else {
      await clearBuildDir(nuxt.options.buildDir)
    }

    await buildNuxt(nuxt)
    await writeTypes(nuxt)
    logger.success(`Types generated in ${colors.cyan(relativeToProcess(nuxt.options.buildDir))}.`)
  },
})
