import process from 'node:process'

import { defineCommand } from 'citty'
import { relative, resolve } from 'pathe'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
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
    await clearBuildDir(nuxt.options.buildDir)

    await buildNuxt(nuxt)
    await writeTypes(nuxt)
    logger.success(
      'Types generated in',
      relative(process.cwd(), nuxt.options.buildDir),
    )
  },
})
