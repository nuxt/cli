import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'

import { cancel, confirm, isCancel, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolveModulePath } from 'exsolve'
import { addDevDependency, detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON, readTSConfig } from 'pkg-types'
import { hasTTY } from 'std-env'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { withNodePath } from '../utils/paths'
import { cwdArgs, dotEnvArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

type TypeChecker = 'vue-tsc' | 'golar'

interface TypeCheckerSetup {
  checker: TypeChecker
  bin: string
}

interface TypeCheckerMeta {
  label: string
  hint: string
  packages: readonly string[]
  docs?: string
}

interface ResolvedTypeChecker {
  missing: string[]
  bin?: string
}

const TYPE_CHECKERS: Record<TypeChecker, TypeCheckerMeta> = {
  'vue-tsc': {
    label: 'vue-tsc',
    hint: 'Vue\'s official TypeScript checker',
    packages: ['typescript', 'vue-tsc'],
  },
  'golar': {
    label: 'Golar',
    hint: 'Native-speed type-checking powered by typescript-go',
    packages: ['golar', '@golar/vue'],
    docs: 'https://golar.dev/languages/vue/',
  },
}

const CHECKER_PRIORITY: TypeChecker[] = ['vue-tsc', 'golar']

const GOLAR_CONFIG_FILES = [
  'golar.config.ts',
  'golar.config.mts',
  'golar.config.mjs',
  'golar.config.cts',
  'golar.config.cjs',
] as const

const GOLAR_CONFIG_TEMPLATE = `import { defineConfig } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({})
`

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs type-checking throughout your app using `vue-tsc` or Golar.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
    checker: {
      type: 'string',
      description: 'Type checker to use (`vue-tsc` or `golar`)',
    },
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const checkerArg = ctx.args.checker
    if (checkerArg && !(checkerArg in TYPE_CHECKERS)) {
      logger.error(`Unknown type checker ${colors.cyan(checkerArg)}. Expected one of: ${CHECKER_PRIORITY.join(', ')}.`)
      process.exitCode = 1
      return
    }

    const [supportsProjects, typechecker] = await Promise.all([
      readTSConfig(cwd).then(config => !!(config.references?.length)),
      resolveTypeChecker(cwd, checkerArg as TypeChecker | undefined),
      writeTypes(cwd, ctx.args.dotenv, ctx.args.logLevel as 'silent' | 'info' | 'verbose', {
        ...ctx.data?.overrides,
        ...(ctx.args.extends && { extends: ctx.args.extends }),
      }),
    ])

    if (!typechecker) {
      process.exitCode = 1
      return
    }

    const start = Date.now()
    const result = await x(typechecker.bin, getTypecheckArgs(typechecker.checker, supportsProjects), {
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

function getTypecheckArgs(checker: TypeChecker, supportsProjects: boolean) {
  if (checker === 'golar') {
    return supportsProjects
      ? ['tsc', '--build', '--noEmit']
      : ['tsc', '--noEmit']
  }

  return supportsProjects
    ? ['-b', '--noEmit']
    : ['--noEmit']
}

async function resolveTypeChecker(cwd: string, preferred?: TypeChecker): Promise<TypeCheckerSetup | undefined> {
  const priority = preferred
    ? [preferred]
    : hasGolarConfig(cwd)
      ? (['golar', 'vue-tsc'] as TypeChecker[])
      : CHECKER_PRIORITY

  for (const checker of priority) {
    const resolved = resolveChecker(checker, cwd)
    if (resolved.missing.length === 0 && resolved.bin) {
      if (checker === 'golar') {
        await ensureGolarConfig(cwd)
      }
      return { checker, bin: resolved.bin }
    }
  }

  return await promptTypeCheckerInstall(cwd, preferred)
}

function resolveChecker(checker: TypeChecker, cwd: string, { cache = true } = {}): ResolvedTypeChecker {
  const from = withNodePath(cwd)

  if (checker === 'golar') {
    const bin = resolveGolarBin(cwd)
    const vuePlugin = resolveModulePath('@golar/vue', { from, try: true, cache })
    const missing = [
      ...(!bin ? ['golar'] : []),
      ...(!vuePlugin ? ['@golar/vue'] : []),
    ]
    return { missing, bin }
  }

  const typescript = resolveModulePath('typescript', { from, try: true, cache })
  const bin = resolveModulePath('vue-tsc/bin/vue-tsc.js', { from, try: true, cache })
  const missing = [
    ...(!typescript ? ['typescript'] : []),
    ...(!bin ? ['vue-tsc'] : []),
  ]
  return { missing, bin }
}

function resolveGolarBin(cwd: string) {
  // golar restricts package exports, so resolve the CLI entry directly
  let dir = cwd
  while (true) {
    const candidate = resolve(dir, 'node_modules/golar/dist/bin.js')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = resolve(dir, '..')
    if (parent === dir) {
      break
    }
    dir = parent
  }

  for (const nodePath of process.env.NODE_PATH?.split(':') || []) {
    const candidate = resolve(nodePath, 'golar/dist/bin.js')
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

function hasGolarConfig(cwd: string) {
  return GOLAR_CONFIG_FILES.some(file => existsSync(resolve(cwd, file)))
}

async function ensureGolarConfig(cwd: string) {
  if (hasGolarConfig(cwd)) {
    return
  }

  const pkg = await readPackageJSON(cwd).catch(() => null)
  const filename = pkg?.type === 'module' ? 'golar.config.ts' : 'golar.config.mts'
  await writeFile(resolve(cwd, filename), GOLAR_CONFIG_TEMPLATE)
  logger.info(`Created ${colors.cyan(filename)}`)
}

async function promptTypeCheckerInstall(cwd: string, preferred?: TypeChecker): Promise<TypeCheckerSetup | undefined> {
  const packageManager = await detectPackageManager(cwd, { includeParentDirs: true })
  const pmName = packageManager?.name ?? 'npm'
  const devFlag = pmName === 'bun' ? '-d' : '-D'
  const pmCommand = packageManager?.command ?? pmName

  if (!hasTTY) {
    printInstallInstructions(pmCommand, devFlag, preferred ? [preferred] : CHECKER_PRIORITY)
    return
  }

  let selected = preferred
  if (!selected) {
    logger.warn(`No type checker found for ${colors.cyan('nuxt typecheck')}.`)

    const answer = await select<TypeChecker>({
      message: 'Which type checker would you like to use?',
      options: CHECKER_PRIORITY.map(name => ({
        value: name,
        label: TYPE_CHECKERS[name].label,
        hint: TYPE_CHECKERS[name].hint,
      })),
      initialValue: 'vue-tsc',
    })

    if (isCancel(answer)) {
      cancel('Skipping installation.')
      return
    }
    selected = answer
  }

  const installCommand = formatInstallCommand(selected, pmCommand, devFlag)
  const { missing } = resolveChecker(selected, cwd)

  if (missing.length > 0) {
    const installed = await installMissingPackages({
      cwd,
      packageManager,
      pmName,
      packages: missing,
      installCommand,
    })
    if (!installed) {
      return
    }
  }

  const resolved = resolveChecker(selected, cwd, { cache: false })
  if (!resolved.bin) {
    logger.error(`Failed to resolve ${colors.cyan(selected)} after installation. Please check your installation.`)
    return
  }

  if (selected === 'golar') {
    await ensureGolarConfig(cwd)
  }

  return { checker: selected, bin: resolved.bin }
}

function printInstallInstructions(pmCommand: string, devFlag: string, checkers: readonly TypeChecker[]) {
  logger.error(`A type checker is required for ${colors.cyan('nuxt typecheck')}. Install ${checkers.length > 1 ? 'one of the following' : 'it as a devDependency'}:\n`)

  for (const checker of checkers) {
    const meta = TYPE_CHECKERS[checker]
    const command = formatInstallCommand(checker, pmCommand, devFlag)
    const docs = meta.docs ? ` (see ${colors.cyan(meta.docs)})` : ''
    logger.info(`${colors.cyan(meta.label)}${docs}:\n\n  ${colors.bold(command)}\n`)
  }

  if (checkers.includes('golar')) {
    logger.info(`Golar also requires a ${colors.cyan('golar.config.ts')} file. One will be created automatically the first time Golar is used.\n`)
  }
}

function formatInstallCommand(checker: TypeChecker, pmCommand: string, devFlag: string) {
  return `${pmCommand} add ${devFlag} ${TYPE_CHECKERS[checker].packages.join(' ')}`
}

async function installMissingPackages(options: {
  cwd: string
  packageManager: Awaited<ReturnType<typeof detectPackageManager>>
  pmName: string
  packages: string[]
  installCommand: string
}): Promise<boolean> {
  const { cwd, packageManager, pmName, packages, installCommand } = options
  const list = packages.map(name => colors.cyan(name)).join(' and ')
  const plural = packages.length > 1
  const devDependency = plural ? 'devDependencies' : 'a devDependency'

  const shouldInstall = await confirm({
    message: `Install ${list} as ${devDependency}?`,
    initialValue: true,
  })

  if (isCancel(shouldInstall) || !shouldInstall) {
    cancel(`Skipping installation. Run ${colors.bold(installCommand)} to install manually.`)
    return false
  }

  const spin = spinner()
  spin.start(`Installing ${list} with ${colors.cyan(pmName)}`)
  try {
    await addDevDependency(packages, { cwd, packageManager, silent: true })
    spin.stop(`Installed ${list}`)
    return true
  }
  catch (error) {
    spin.error(`Failed to install ${list}`)
    logger.error(error instanceof Error ? error.message : String(error))
    logger.info(`You can install ${plural ? 'them' : 'it'} manually with:\n\n  ${colors.bold(installCommand)}\n`)
    return false
  }
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

  await writeTypes(nuxt)
  await buildNuxt(nuxt)
  await nuxt.close()
}
