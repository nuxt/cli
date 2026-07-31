import process from 'node:process'

import { styleText } from 'node:util'
import { defineCommand } from 'citty'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'prepare',
    description: 'Prepare Nuxt for development/build',
  },
  args: {
    ...rootDirArgs,
    ...dotEnvArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...extendsArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolveRootDir(ctx.args)

    const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      cwd,
      dotenv: {
        cwd,
        fileName: ctx.args.dotenv,
      },
      envName: ctx.args.envName, // nuxt will fall back to NODE_ENV
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
    logger.success(`Types generated in ${styleText('cyan', relativeToProcess(nuxt.options.buildDir))}.`)
  },
})
