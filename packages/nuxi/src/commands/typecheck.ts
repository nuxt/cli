import process from 'node:process'

import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { resolve } from 'pathe'
import { readTSConfig } from 'pkg-types'
import { isBun } from 'std-env'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs `vue-tsc` to check types throughout your app.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const [supportsProjects, resolvedTypeScript, resolvedVueTsc] = await Promise.all([
      readTSConfig(cwd).then(r => !!(r.references?.length)),
      // Prefer local install if possible
      resolveModulePath('typescript', { try: true }),
      resolveModulePath('vue-tsc/bin/vue-tsc.js', { try: true }),
      writeTypes(cwd, ctx.args.dotenv, ctx.args.logLevel as 'silent' | 'info' | 'verbose', ctx.args.extends),
    ])

    const typeCheckArgs = supportsProjects ? ['-b', '--noEmit'] : ['--noEmit']
    if (resolvedTypeScript && resolvedVueTsc) {
      return await x(resolvedVueTsc, typeCheckArgs, {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      })
    }

    if (isBun) {
      await x('bun', ['install', 'typescript', 'vue-tsc', '--global', '--silent'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd },
      })

      return await x('bunx', ['vue-tsc', ...typeCheckArgs], {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      })
    }

    await x('npx', ['-p', 'vue-tsc', '-p', 'typescript', 'vue-tsc', ...typeCheckArgs], {
      throwOnError: true,
      nodeOptions: { stdio: 'inherit', cwd },
    })
  },
})

async function writeTypes(cwd: string, dotenv?: string, logLevel?: 'silent' | 'info' | 'verbose', extendsValue?: string) {
  const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
  const nuxt = await loadNuxt({
    cwd,
    dotenv: { cwd, fileName: dotenv },
    overrides: {
      _prepare: true,
      logLevel,
      ...(extendsValue && { extends: extendsValue }),
    },
  })

  // Generate types and build Nuxt instance
  await writeTypes(nuxt)
  await buildNuxt(nuxt)
  await nuxt.close()
}
