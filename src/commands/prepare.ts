import { relative, resolve } from 'pathe'
import { consola } from 'consola'

import { defineCommand } from 'citty'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'

import { envNameArgs, legacyRootDirArgs, dotEnvArgs, cwdArgs, logLevelArgs } from './_shared'

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
        ...ctx.data?.overrides,
      },
    })
    await clearBuildDir(nuxt.options.buildDir)

    await buildNuxt(nuxt)
    await writeTypes(nuxt)
    consola.success(
      'Types generated in',
      relative(process.cwd(), nuxt.options.buildDir),
    )
  },
})
