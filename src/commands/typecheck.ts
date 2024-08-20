import { execa } from 'execa'
import { resolve } from 'pathe'
import { defineCommand } from 'citty'

// we are deliberately inlining this code as a backup in case user has `@nuxt/schema<3.7`
import { writeTypes as writeTypesLegacy } from '@nuxt/kit'

import { tryResolveModule } from '../utils/esm'
import { loadKit } from '../utils/kit'

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs `vue-tsc` to check types throughout your app.',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    const {
      loadNuxt,
      buildNuxt,
      writeTypes = writeTypesLegacy,
    } = await loadKit(cwd)
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

    // Prefer local install if possible
    const [resolvedTypeScript, resolvedVueTsc] = await Promise.all([
      tryResolveModule('typescript'),
      tryResolveModule('vue-tsc/bin/vue-tsc.js'),
    ])
    if (resolvedTypeScript && resolvedVueTsc) {
      await execa(resolvedVueTsc, ['--noEmit'], {
        preferLocal: true,
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
  },
})
