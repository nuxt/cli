import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolve } from 'pathe'
import { defineCommand } from 'citty'
import { isBun } from 'std-env'
import { createJiti } from 'jiti'

// we are deliberately inlining this code as a backup in case user has `@nuxt/schema<3.7`
import { writeTypes as writeTypesLegacy } from '@nuxt/kit'

import { loadKit } from '../utils/kit'

import { cwdArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs `vue-tsc` to check types throughout your app.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const { loadNuxt, buildNuxt, writeTypes = writeTypesLegacy } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      cwd,
      overrides: {
        _prepare: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      },
    })

    // Generate types and build Nuxt instance
    await writeTypes(nuxt)
    await buildNuxt(nuxt)
    await nuxt.close()

    const jiti = createJiti(cwd)

    // Prefer local install if possible
    const [resolvedTypeScript, resolvedVueTsc] = await Promise.all([
      jiti.esmResolve('typescript', { try: true }),
      jiti.esmResolve('vue-tsc/bin/vue-tsc.js', { try: true }),
    ])
    if (resolvedTypeScript && resolvedVueTsc) {
      await execa(fileURLToPath(resolvedVueTsc), ['--noEmit'], {
        preferLocal: true,
        stdio: 'inherit',
        cwd,
      })
    }
    else {
      if (isBun) {
        await execa(
          'bun',
          'install typescript vue-tsc --global --silent'.split(' '),
          { stdio: 'inherit', cwd },
        )

        await execa('bunx', 'vue-tsc --noEmit'.split(' '), {
          stdio: 'inherit',
          cwd,
        })
      }
      else {
        await execa(
          'npx',
          '-p vue-tsc -p typescript vue-tsc --noEmit'.split(' '),
          { stdio: 'inherit', cwd },
        )
      }
    }
  },
})
