import process from 'node:process'

import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { resolve } from 'pathe'
import { readTSConfig } from 'pkg-types'
import { isBun } from 'std-env'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { cwdArgs, dotEnvArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs `vue-tsc` to check types throughout your app.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
    const nuxt = await loadNuxt({
      cwd,
      dotenv: { cwd, fileName: ctx.args.dotenv },
      overrides: {
        _prepare: true,
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
      },
    })

    // Generate types and build Nuxt instance
    await writeTypes(nuxt)
    await buildNuxt(nuxt)
    await nuxt.close()

    const supportsProjects = await readTSConfig(cwd).then(r => !!(r.references?.length))
    const typeCheckArgs = supportsProjects ? ['-b', '--noEmit'] : ['--noEmit']

    // Prefer local install if possible
    const [resolvedTypeScript, resolvedVueTsc] = await Promise.all([
      resolveModulePath('typescript', { try: true }),
      resolveModulePath('vue-tsc/bin/vue-tsc.js', { try: true }),
    ])
    if (resolvedTypeScript && resolvedVueTsc) {
      await x(resolvedVueTsc, typeCheckArgs, {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      })
    }
    else {
      if (isBun) {
        await x(
          'bun',
          'install typescript vue-tsc --global --silent'.split(' '),
          {
            throwOnError: true,
            nodeOptions: { stdio: 'inherit', cwd },
          },
        )

        await x('bunx', ['vue-tsc', ...typeCheckArgs], {
          throwOnError: true,
          nodeOptions: {
            stdio: 'inherit',
            cwd,
          },
        })
      }
      else {
        await x(
          'npx',
          ['-p', 'vue-tsc', '-p', 'typescript', 'vue-tsc', ...typeCheckArgs],
          {
            throwOnError: true,
            nodeOptions: { stdio: 'inherit', cwd },
          },
        )
      }
    }
  },
})
