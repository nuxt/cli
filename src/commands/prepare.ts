import { relative, resolve } from 'pathe'
import { consola } from 'consola'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { writeTypes } from '../utils/prepare'
import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'prepare',
    description: 'Prepare nuxt for development/build',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    const { loadNuxt, buildNuxt } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      rootDir: cwd,
      overrides: {
        _prepare: true,
        logLevel: ctx.args.logLeve as 'silent' | 'info' | 'verbose',
        .../*ctx.options.overrides || */ {},
      },
    })
    await clearBuildDir(nuxt.options.buildDir)

    await buildNuxt(nuxt)
    await writeTypes(nuxt)
    consola.success(
      'Types generated in',
      relative(process.cwd(), nuxt.options.buildDir)
    )
  },
})
