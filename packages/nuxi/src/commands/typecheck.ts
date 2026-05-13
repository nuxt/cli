import process from 'node:process'

import { cancel, confirm, isCancel, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolveModulePath } from 'exsolve'
import { addDevDependency, detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { readTSConfig } from 'pkg-types'
import { hasTTY } from 'std-env'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

const REQUIRED_DEPS = {
  'typescript': 'typescript',
  'vue-tsc': 'vue-tsc/bin/vue-tsc.js',
} as const

type DepName = keyof typeof REQUIRED_DEPS

function resolveDeps({ cache }: { cache?: boolean } = {}) {
  const out = {} as Record<DepName, string | undefined>
  for (const name in REQUIRED_DEPS) {
    out[name as DepName] = resolveModulePath(REQUIRED_DEPS[name as DepName], { try: true, cache })
  }
  return out
}

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

    const [supportsProjects, vueTsc] = await Promise.all([
      readTSConfig(cwd).then(r => !!(r.references?.length)),
      ensureVueTsc(cwd, resolveDeps()),
      writeTypes(cwd, ctx.args.dotenv, ctx.args.logLevel as 'silent' | 'info' | 'verbose', {
        ...ctx.data?.overrides,
        ...(ctx.args.extends && { extends: ctx.args.extends }),
      }),
    ])

    if (!vueTsc) {
      process.exitCode = 1
      return
    }

    const start = Date.now()
    const result = await x(vueTsc, supportsProjects ? ['-b', '--noEmit'] : ['--noEmit'], {
      nodeOptions: { stdio: 'inherit', cwd },
    })
    const duration = `${Date.now() - start}ms`

    if (result.exitCode === 0) {
      if (hasTTY) {
        logger.success(`Type check passed in ${colors.cyan(duration)}.`)
      }
      return
    }

    if (hasTTY) {
      logger.error(`Type check failed in ${colors.cyan(duration)}.`)
    }
    process.exitCode = result.exitCode ?? 1
  },
})

async function ensureVueTsc(cwd: string, deps: Record<DepName, string | undefined>): Promise<string | undefined> {
  const missing = (Object.keys(REQUIRED_DEPS) as DepName[]).filter(name => !deps[name])
  if (missing.length === 0) {
    return deps['vue-tsc']
  }

  const packageManager = await detectPackageManager(cwd, { includeParentDirs: true })
  const pmName = packageManager?.name ?? 'npm'
  const installCommand = `${packageManager?.command ?? pmName} add ${pmName === 'bun' ? '-d' : '-D'} ${missing.join(' ')}`

  const list = missing.map(name => colors.cyan(name)).join(' and ')
  const plural = missing.length > 1
  const are = plural ? 'are' : 'is'
  const devDependency = plural ? 'devDependencies' : 'a devDependency'

  if (!hasTTY) {
    logger.error(`${list} ${are} required for ${colors.cyan('nuxt typecheck')}. Install ${plural ? 'them' : 'it'} as ${devDependency}:\n\n  ${colors.bold(installCommand)}\n`)
    return
  }

  logger.warn(`${list} ${are} required for ${colors.cyan('nuxt typecheck')} but ${plural ? 'were' : 'was'} not found.`)

  const shouldInstall = await confirm({
    message: `Install ${list} as ${devDependency}?`,
    initialValue: true,
  })

  if (isCancel(shouldInstall) || !shouldInstall) {
    cancel(`Skipping installation. Run ${colors.bold(installCommand)} to install manually.`)
    return
  }

  const spin = spinner()
  spin.start(`Installing ${list} with ${colors.cyan(pmName)}`)
  try {
    await addDevDependency(missing, { cwd, packageManager, silent: true })
    spin.stop(`Installed ${list}`)
  }
  catch (error) {
    spin.error(`Failed to install ${list}`)
    logger.error(error instanceof Error ? error.message : String(error))
    logger.info(`You can install ${plural ? 'them' : 'it'} manually with:\n\n  ${colors.bold(installCommand)}\n`)
    return
  }

  return resolveDeps({ cache: false })['vue-tsc']
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
