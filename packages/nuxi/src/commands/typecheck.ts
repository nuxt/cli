import process from 'node:process'

import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { resolve } from 'pathe'
import { readTSConfig } from 'pkg-types'
import { isBun } from 'std-env'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

type Executor = 'vue-tsc' | 'golar'

const executorPackages: Record<Executor, string[]> = {
  'vue-tsc': ['vue-tsc'],
  'golar': ['golar', '@golar/vue'],
}

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs process to check types throughout your app.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
    executor: {
      type: 'string',
      description: 'TypeScript type checker executor',
      valueHint: Object.keys(executorPackages).join('|'),
      default: 'vue-tsc',
    },
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const executor = isExecutor(ctx.args.executor) ? ctx.args.executor : 'vue-tsc'

    const [supportsProjects, resolvedTypeScript, resolvedExecutor] = await Promise.all([
      readTSConfig(cwd).then(r => !!(r.references?.length)),
      // Prefer local install if possible
      resolveModulePath('typescript', { try: true }),
      resolveExecutor(executor),
      writeTypes(cwd, ctx.args.dotenv, ctx.args.logLevel as 'silent' | 'info' | 'verbose', {
        ...ctx.data?.overrides,
        ...(ctx.args.extends && { extends: ctx.args.extends }),
      }),
    ])

    const typeCheckArgs = supportsProjects ? ['-b', '--noEmit'] : ['--noEmit']
    if (resolvedTypeScript && resolvedExecutor) {
      return await x(resolvedExecutor, typeCheckArgs, {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      })
    }

    if (isBun) {
      await x('bun', ['install', 'typescript', ...executorPackages[executor], '--global', '--silent'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd },
      })

      return await x('bunx', [executor, ...typeCheckArgs], {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd,
        },
      })
    }

    await x('npx', [
      // install executor packages
      ...executorPackages[executor].flatMap(pkg => ['-p', pkg]),
      // install typescript
      '-p',
      'typescript',
      // execute type checker
      executor,
      ...typeCheckArgs,
    ], {
      throwOnError: true,
      nodeOptions: { stdio: 'inherit', cwd },
    })
  },
})

function isExecutor(value: unknown): value is Executor {
  return value === 'vue-tsc' || value === 'golar'
}

async function resolveExecutor(executor: Executor) {
  if (executor === 'golar') {
    logger.warn('Golar is experimental. Type-checking results may be incomplete or inaccurate.')
    return resolveModulePath('golar/dist/bin.js', { try: true })
  }

  return resolveModulePath('vue-tsc/bin/vue-tsc.js', { try: true })
}

async function writeTypes(cwd: string, dotenv?: string, logLevel?: 'silent' | 'info' | 'verbose', overrides?: Record<string, any>) {
  const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
  const nuxt = await loadNuxt({
    cwd,
    dotenv: { cwd, fileName: dotenv },
    overrides: {
      _prepare: true,
      logLevel,
      ...overrides,
    },
  })

  // Generate types and build Nuxt instance
  await writeTypes(nuxt)
  await buildNuxt(nuxt)
  await nuxt.close()
}
