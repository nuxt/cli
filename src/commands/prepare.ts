import { relative, resolve } from 'pathe'
import { consola } from 'consola'
// we are deliberately inlining this code as a backup in case user has `@nuxt/schema<3.7`
import { writeTypes as writeTypesLegacy } from '@nuxt/kit'

import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
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

    const { loadNuxt, buildNuxt, writeTypes = writeTypesLegacy } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      rootDir: cwd,
      overrides: {
        _prepare: true,
        logLevel: ctx.args.logLeve as 'silent' | 'info' | 'verbose',
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
