import type { TSConfig } from 'pkg-types'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'

import { styleText } from 'node:util'
import { cancel, confirm, isCancel, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { addDevDependency, detectPackageManager } from 'nypm'
import { dirname, resolve } from 'pathe'
import { readPackageJSON, readTSConfig } from 'pkg-types'
import { hasTTY } from 'std-env'
import { x } from 'tinyexec'

import { resolveDotenvFileNames } from '../utils/args'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { resolveRootDir, withNodePath } from '../utils/paths'
import { dotEnvArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

type TypeChecker = 'vue-tsc' | 'golar'

interface TypeCheckerSetup {
  checker: TypeChecker
  bin: string
}

interface ResolvedTypeChecker {
  bin?: string
  missing: string[]
}

interface TypeCheckerBackend {
  label: string
  hint: string
  packages: readonly string[]
  docs?: string
  /** Config files whose presence makes this checker the preferred one. */
  configFiles?: readonly string[]
  /** Extra note shown alongside install instructions in non-interactive mode. */
  configNote?: string
  resolve: (cwd: string, options?: { cache?: boolean }) => ResolvedTypeChecker
  args: (supportsProjects: boolean) => string[]
  ensureConfig?: (cwd: string) => Promise<void>
}

const GOLAR_CONFIG_FILES = [
  'golar.config.js',
  'golar.config.ts',
  'golar.config.mjs',
  'golar.config.mts',
  'golar.config.cjs',
  'golar.config.cts',
] as const

const GOLAR_CONFIG_TEMPLATE = `import { defineConfig } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({})
`

const TYPE_CHECKERS: Record<TypeChecker, TypeCheckerBackend> = {
  'vue-tsc': {
    label: 'vue-tsc',
    hint: 'Vue\'s official TypeScript checker',
    packages: ['typescript', 'vue-tsc'],
    resolve(cwd, { cache = true } = {}) {
      const from = withNodePath(cwd)
      const typescript = resolveModulePath('typescript', { from, try: true, cache })
      const bin = resolveModulePath('vue-tsc/bin/vue-tsc.js', { from, try: true, cache })
      return {
        bin: bin ?? undefined,
        missing: [
          ...(!typescript ? ['typescript'] : []),
          ...(!bin ? ['vue-tsc'] : []),
        ],
      }
    },
    args: supportsProjects => supportsProjects ? ['-b', '--noEmit'] : ['--noEmit'],
  },
  'golar': {
    label: 'Golar',
    hint: 'Native-speed type-checking powered by typescript-go',
    packages: ['golar', '@golar/vue'],
    docs: 'https://golar.dev/languages/vue/',
    configFiles: GOLAR_CONFIG_FILES,
    configNote: `Golar also requires a ${styleText('cyan', 'golar.config.ts')} file. One will be created automatically the first time Golar is used.`,
    resolve(cwd, { cache = true } = {}) {
      const bin = resolveGolarBin(cwd, cache)
      const vuePlugin = resolveModulePath('@golar/vue', { from: withNodePath(cwd), try: true, cache })
      return {
        bin,
        missing: [
          ...(!bin ? ['golar'] : []),
          ...(!vuePlugin ? ['@golar/vue'] : []),
        ],
      }
    },
    args: supportsProjects => supportsProjects ? ['tsc', '--build', '--noEmit'] : ['tsc', '--noEmit'],
    ensureConfig: ensureGolarConfig,
  },
}

const CHECKER_PRIORITY = Object.keys(TYPE_CHECKERS) as TypeChecker[]

export default defineCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs type-checking throughout your app using `vue-tsc` or Golar.',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...extendsArgs,
    checker: {
      type: 'string',
      description: 'Type checker to use (`vue-tsc` or `golar`)',
    },
    build: {
      type: 'boolean',
      alias: 'b',
      description: 'Type-check in build mode, using TypeScript project references (detected automatically by default)',
    },
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolveRootDir(ctx.args)

    const checkerArg = ctx.args.checker
    if (checkerArg && !Object.hasOwn(TYPE_CHECKERS, checkerArg)) {
      logger.error(`Unknown type checker ${styleText('cyan', checkerArg)}. Expected one of: ${CHECKER_PRIORITY.join(', ')}.`)
      process.exitCode = 1
      return
    }

    const typechecker = await resolveTypeChecker(cwd, checkerArg as TypeChecker | undefined)
    if (!typechecker) {
      process.exitCode = 1
      return
    }

    const [tsConfig] = await Promise.all([
      readTSConfig(cwd).catch(() => ({} as TSConfig)),
      writeTypes(cwd, ctx.args.dotenv, ctx.args.logLevel as 'silent' | 'info' | 'verbose', {
        ...ctx.data?.overrides,
        ...(ctx.args.extends.length > 0 && { extends: ctx.args.extends }),
      }),
    ])

    const useProjectReferences = ctx.args.build ?? supportsProjectReferences(tsConfig)

    if (ctx.args.build === undefined && !useProjectReferences && hasNuxtProjectReferences(tsConfig)) {
      logger.warn(`Your ${styleText('cyan', 'tsconfig.json')} references Nuxt's generated project configs but also includes source files of its own, so type-checking will not run in build mode. Add ${styleText('cyan', '"files": []')} to your ${styleText('cyan', 'tsconfig.json')}, or pass ${styleText('cyan', '--build')} to override.`)
    }

    const start = Date.now()
    const result = await x(typechecker.bin, TYPE_CHECKERS[typechecker.checker].args(useProjectReferences), {
      nodeOptions: { stdio: 'inherit', cwd },
    })
    const duration = `${Date.now() - start}ms`

    if (result.exitCode === 0) {
      if (hasTTY) {
        logger.success(`Type check passed in ${styleText('cyan', duration)}.`)
      }
      return
    }

    if (hasTTY) {
      logger.error(`Type check failed in ${styleText('cyan', duration)}.`)
    }
    process.exitCode = result.exitCode ?? 1
  },
})

const NUXT_PROJECT_REFERENCE_RE = /(?:^|[/\\])tsconfig\.(?:app|server|shared|node)\.json$/

/**
 * Whether a tsconfig is a solution-style config, as used by Nuxt's project references setup.
 *
 * Building a config that has input files of its own alongside references makes TypeScript apply
 * `--noEmit` to every referenced project, which fails with `TS6310` for emitting projects.
 */
function supportsProjectReferences(config: TSConfig): boolean {
  if (!config.references?.length) {
    return false
  }
  return config.files?.length === 0 && !config.include?.length
}

function hasNuxtProjectReferences(config: TSConfig): boolean {
  return !!config.references?.some(reference => reference.path && NUXT_PROJECT_REFERENCE_RE.test(reference.path))
}

async function resolveTypeChecker(cwd: string, preferred?: TypeChecker): Promise<TypeCheckerSetup | undefined> {
  const priority = preferred ? [preferred] : detectCheckerPriority(cwd)

  for (const checker of priority) {
    const resolved = TYPE_CHECKERS[checker].resolve(cwd)
    if (resolved.bin && resolved.missing.length === 0) {
      await TYPE_CHECKERS[checker].ensureConfig?.(cwd)
      return { checker, bin: resolved.bin }
    }
  }

  return await promptTypeCheckerInstall(cwd, preferred)
}

function detectCheckerPriority(cwd: string): TypeChecker[] {
  const configured = CHECKER_PRIORITY.filter(checker => hasCheckerConfig(checker, cwd))
  return [...configured, ...CHECKER_PRIORITY.filter(checker => !configured.includes(checker))]
}

function hasCheckerConfig(checker: TypeChecker, cwd: string) {
  return TYPE_CHECKERS[checker].configFiles?.some(file => existsSync(resolve(cwd, file))) ?? false
}

function resolveGolarBin(cwd: string, cache = true): string | undefined {
  const entry = resolveModulePath('golar/unstable', { from: withNodePath(cwd), try: true, cache })
  if (!entry) {
    return undefined
  }

  let dir = dirname(entry)
  while (true) {
    const manifest = resolve(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name, bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string, bin?: string | Record<string, string> }
      if (name === 'golar') {
        const relativeBin = typeof bin === 'string' ? bin : bin?.golar
        return relativeBin ? resolve(dir, relativeBin) : undefined
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

async function ensureGolarConfig(cwd: string) {
  if (hasCheckerConfig('golar', cwd)) {
    return
  }

  const pkg = await readPackageJSON(cwd).catch(() => null)
  const filename = pkg?.type === 'module' ? 'golar.config.ts' : 'golar.config.mts'
  await writeFile(resolve(cwd, filename), GOLAR_CONFIG_TEMPLATE)
  logger.info(`Created ${styleText('cyan', filename)}`)
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
    logger.warn(`No type checker found for ${styleText('cyan', 'nuxt typecheck')}.`)

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
  const { missing } = TYPE_CHECKERS[selected].resolve(cwd)

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

  const resolved = TYPE_CHECKERS[selected].resolve(cwd, { cache: false })
  if (!resolved.bin || resolved.missing.length > 0) {
    logger.error(`Failed to resolve ${styleText('cyan', resolved.missing.join(' and ') || selected)} after installation. Please check your installation.`)
    return
  }

  await TYPE_CHECKERS[selected].ensureConfig?.(cwd)

  return { checker: selected, bin: resolved.bin }
}

function printInstallInstructions(pmCommand: string, devFlag: string, checkers: readonly TypeChecker[]) {
  logger.error(`A type checker is required for ${styleText('cyan', 'nuxt typecheck')}. Install ${checkers.length > 1 ? 'one of the following' : 'it as a devDependency'}:\n`)

  for (const checker of checkers) {
    const meta = TYPE_CHECKERS[checker]
    const command = formatInstallCommand(checker, pmCommand, devFlag)
    const docs = meta.docs ? ` (see ${styleText('cyan', meta.docs)})` : ''
    logger.info(`${styleText('cyan', meta.label)}${docs}:\n\n  ${styleText('bold', command)}\n`)
    if (meta.configNote) {
      logger.info(`${meta.configNote}\n`)
    }
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
  const list = packages.map(name => styleText('cyan', name)).join(' and ')
  const plural = packages.length > 1
  const devDependency = plural ? 'devDependencies' : 'a devDependency'

  const shouldInstall = await confirm({
    message: `Install ${list} as ${devDependency}?`,
    initialValue: true,
  })

  if (isCancel(shouldInstall) || !shouldInstall) {
    cancel(`Skipping installation. Run ${styleText('bold', installCommand)} to install manually.`)
    return false
  }

  const spin = spinner()
  spin.start(`Installing ${list} with ${styleText('cyan', pmName)}`)
  try {
    await addDevDependency(packages, { cwd, packageManager, silent: true })
    spin.stop(`Installed ${list}`)
    return true
  }
  catch (error) {
    spin.error(`Failed to install ${list}`)
    logger.error(error instanceof Error ? error.message : String(error))
    logger.info(`You can install ${plural ? 'them' : 'it'} manually with:\n\n  ${styleText('bold', installCommand)}\n`)
    return false
  }
}

async function writeTypes(cwd: string, dotenv?: string[], logLevel?: 'silent' | 'info' | 'verbose', overrides?: Record<string, any>) {
  const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
  const nuxt = await loadNuxt({
    cwd,
    dotenv: { cwd, fileName: resolveDotenvFileNames(dotenv) },
    overrides: {
      _prepare: true,
      logLevel,
      ...overrides,
    },
  })

  try {
    await writeTypes(nuxt)
    await buildNuxt(nuxt)
  }
  finally {
    await nuxt.close()
  }
}
