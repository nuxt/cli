import type { ArgsDef } from 'citty'
import type { DetectResult } from 'package-manager-detector'
import type { PackageJson } from 'pkg-types'

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { styleText } from 'node:util'

import { cancel, confirm, isCancel } from '@clack/prompts'
import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { resolveCommand } from 'package-manager-detector/commands'
import { dirname, resolve } from 'pathe'
import { x } from 'tinyexec'

import { ActionableError } from '../../utils/errors'
import { createInstallLog, runInstall } from '../../utils/install'
import { logger } from '../../utils/logger'
import { defaultPackageManager, detectPackageManager } from '../../utils/package-managers'
import { resolveRootDir } from '../../utils/paths'
import { withNodePath } from '../../utils/resolve-nuxt'
import { createSpinner } from '../../utils/spinner'
import { isInteractive } from '../../utils/stdout'
import { globalCwdArgs } from '../_shared'

const MODULE_BUILDER = '@nuxt/module-builder'
/** Peers of the module builder that `nuxt module` installs alongside it. */
const PEERS = ['tsdown', 'typescript']
const WHITESPACE_RE = /\s/

const moduleRootArgs = {
  rootDir: {
    type: 'positional',
    description: 'The root directory of your Nuxt module (default: .)',
    required: false,
    default: undefined,
  },
  // Overrides the description of the global `--cwd`, which names a Nuxt project.
  cwd: {
    ...globalCwdArgs.cwd,
    description: 'Specify the root directory of your Nuxt module',
  },
} as const satisfies ArgsDef

/**
 * A `nuxt module` subcommand that runs the same subcommand of the
 * `nuxt-module-build` CLI from the module's `@nuxt/module-builder`.
 *
 * Every argument is forwarded, so flags added to the module builder later work
 * without a CLI release; the ones declared here are for `--help` and the docs.
 */
export function defineModuleBuilderCommand<T extends ArgsDef>(name: 'build' | 'prepare', description: string, args: T) {
  return defineCommand({
    meta: { name, description },
    args: { ...moduleRootArgs, ...args },
    async run(ctx) {
      const rootDir = resolveRootDir(ctx.args)
      const bin = await ensureModuleBuilder(rootDir, name)

      // The arguments are forwarded as given, including a `--cwd` passed before
      // `module`, so the module builder reads them exactly as
      // `nuxt-module-build` would, even flags this CLI does not declare.
      const result = await x(process.execPath, [bin, name, ...ctx.rawArgs], {
        nodeOptions: { stdio: 'inherit' },
        throwOnError: false,
      })
      if (result.exitCode !== 0) {
        process.exit(result.exitCode ?? 1)
      }
    },
  })
}

interface ModuleBuilder {
  /** The `nuxt-module-build` script. */
  bin: string
  /** The required peers out of {@link PEERS} that this version declares, with their ranges. */
  peers: Record<string, string>
}

/** The module's `@nuxt/module-builder`, if it has one with a `nuxt-module-build` command. */
function resolveModuleBuilder(rootDir: string): ModuleBuilder | undefined {
  const manifest = resolveModulePath(`${MODULE_BUILDER}/package.json`, { from: withNodePath(rootDir), try: true, cache: false })
  if (!manifest) {
    return
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Pick<PackageJson, 'bin' | 'peerDependencies' | 'peerDependenciesMeta'>
  const script = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['nuxt-module-build']
  if (!script) {
    return
  }
  const peers = Object.entries(pkg.peerDependencies ?? {})
    .filter(([name]) => PEERS.includes(name) && !pkg.peerDependenciesMeta?.[name]?.optional)
  return { bin: resolve(dirname(manifest), script), peers: Object.fromEntries(peers) }
}

function isResolvable(rootDir: string, name: string): boolean {
  return Boolean(resolveModulePath(name, { from: withNodePath(rootDir), try: true, cache: false }))
}

/**
 * A package spec for `name` at `range`. A range that cannot be part of a spec
 * (`*`, `^5.9.3 || ^6.0.0`) falls back to the bare name, as `nuxt module add`
 * does for peer dependencies.
 */
function packageSpec(name: string, range: string | undefined): string {
  return range && range !== '*' && !WHITESPACE_RE.test(range) ? `${name}@${range}` : name
}

/**
 * The `nuxt-module-build` script of the module's `@nuxt/module-builder`, after
 * offering to install the builder and the `tsdown` and `typescript` peers it
 * builds with when the module is missing any of them.
 */
async function ensureModuleBuilder(rootDir: string, command: string): Promise<string> {
  let builder = resolveModuleBuilder(rootDir)
  // Until the builder is installed, the peers it declares are not known, so the
  // ones the current release requires are checked. They are only installed
  // below if the installed builder declares them.
  const missingPeers = (builder ? Object.keys(builder.peers) : PEERS).filter(name => !isResolvable(rootDir, name))
  if (builder && missingPeers.length === 0) {
    return builder.bin
  }

  const packageManager = await detectPackageManager(rootDir) ?? defaultPackageManager
  if (!isInteractive()) {
    // Without the builder, the ranges of its peers are not known yet, so only
    // the builder is asked for; the next run asks for the peers it declares.
    const deps = builder ? missingPeers.map(name => packageSpec(name, builder!.peers[name])) : [MODULE_BUILDER]
    throw new ActionableError(`${describeMissing(command, builder ? missingPeers : [MODULE_BUILDER])} Install ${deps.length > 1 ? 'them' : 'it'} with ${styleText('bold', formatInstallCommand(packageManager, deps))}.`)
  }

  const missing = [...builder ? [] : [MODULE_BUILDER], ...missingPeers]
  const list = formatList(missing)
  const message = describeMissing(command, missing)

  logger.warn(message)
  const answer = await confirm({ message: `Install ${list} as ${missing.length > 1 ? 'devDependencies' : 'a devDependency'}?`, initialValue: true })
  if (isCancel(answer) || !answer) {
    cancel('Skipping installation.')
    process.exit(1)
  }

  if (!builder) {
    await installDevDependencies(rootDir, packageManager, [MODULE_BUILDER])
    builder = resolveModuleBuilder(rootDir)
    if (!builder) {
      throw new ActionableError(`${MODULE_BUILDER} was installed but its \`nuxt-module-build\` command could not be found.`)
    }
  }

  // Peers are installed even when the builder's install pulled them into
  // `node_modules`, so the module declares the tools its build runs.
  const { peers } = builder
  const peerSpecs = missingPeers.filter(name => name in peers).map(name => packageSpec(name, peers[name]))
  if (peerSpecs.length > 0) {
    await installDevDependencies(rootDir, packageManager, peerSpecs)
  }

  return builder.bin
}

async function installDevDependencies(rootDir: string, packageManager: DetectResult, dependencies: string[]): Promise<void> {
  const list = formatList(dependencies)
  const installLog = createInstallLog()
  const spinner = createSpinner({ indicator: 'timer' })
  spinner.start(`Installing ${list} with ${styleText('cyan', packageManager.name)}`)
  const result = await runInstall({
    cwd: rootDir,
    packageManager,
    dependencies,
    dev: true,
    onOutput: installLog.onOutput,
    onStatus: message => spinner.message(message),
  })
  if (!result.success) {
    spinner.error(result.error ?? 'Install failed')
    installLog.finish(result)
    throw new ActionableError(`Could not install ${list}. Install ${dependencies.length > 1 ? 'them' : 'it'} with ${styleText('bold', formatInstallCommand(packageManager, dependencies))}.`)
  }
  spinner.stop(`Installed ${list}`)
  installLog.finish(result)
}

function describeMissing(command: string, missing: string[]): string {
  return `${styleText('cyan', `nuxt module ${command}`)} needs ${formatList(missing)}, which ${missing.length > 1 ? 'are' : 'is'} not installed in this module.`
}

function formatInstallCommand(packageManager: DetectResult, dependencies: string[]): string {
  const { command, args } = resolveCommand(packageManager.agent, 'add', ['-D', ...dependencies])!
  return [command, ...args].join(' ')
}

function formatList(names: string[]): string {
  const styled = names.map(name => styleText('cyan', name))
  return styled.length > 1 ? `${styled.slice(0, -1).join(', ')} and ${styled.at(-1)}` : styled[0]!
}
