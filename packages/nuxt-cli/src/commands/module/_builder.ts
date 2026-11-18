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
import { relativeToProcess, resolveRootDir } from '../../utils/paths'
import { withNodePath } from '../../utils/resolve-nuxt'
import { createSpinner } from '../../utils/spinner'
import { isInteractive } from '../../utils/stdout'
import { globalCwdArgs } from '../_shared'

const MODULE_BUILDER = '@nuxt/module-builder'
const PEERS = ['tsdown', 'typescript']
const WHITESPACE_RE = /\s/

const moduleRootArgs = {
  rootDir: {
    type: 'positional',
    description: 'The root directory of your Nuxt module (default: .)',
    required: false,
    default: undefined,
  },
  cwd: {
    ...globalCwdArgs.cwd,
    description: 'Specify the root directory of your Nuxt module',
  },
} as const satisfies ArgsDef

// `args` populate `--help` and generated docs; `ctx.rawArgs` forwards all flags to `nuxt-module-build`.
export function defineModuleBuilderCommand<T extends ArgsDef>(name: 'build' | 'prepare', description: string, args: T) {
  return defineCommand({
    meta: { name, description },
    args: { ...moduleRootArgs, ...args },
    async run(ctx) {
      const rootDir = resolveRootDir(ctx.args)
      const bin = await ensureModuleBuilder(rootDir, name)

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
  bin: string
  dir: string
  peers: Record<string, string>
}

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
  const dir = dirname(manifest)
  const peers = Object.entries(pkg.peerDependencies ?? {})
    .filter(([name]) => PEERS.includes(name) && !pkg.peerDependenciesMeta?.[name]?.optional)
  return { bin: resolve(dir, script), dir, peers: Object.fromEntries(peers) }
}

// Pick the last `||` branch (`^5.9.3 || ^6.0.0` -> `^6.0.0`) so union ranges stay a single argument,
// and fall back to the bare name for `*` or ranges with spaces (`>=3 <5`).
function packageSpec(name: string, range: string | undefined): string {
  const target = range?.split('||').at(-1)?.trim()
  return target && target !== '*' && !WHITESPACE_RE.test(target) ? `${name}@${target}` : name
}

async function ensureModuleBuilder(rootDir: string, command: string): Promise<string> {
  let builder = resolveModuleBuilder(rootDir)
  // Resolve without `NODE_PATH` because ESM imports in `@nuxt/module-builder` ignore it.
  const resolveFrom = builder?.dir ?? rootDir
  const missingPeers = (builder ? Object.keys(builder.peers) : PEERS)
    .filter(name => !resolveModulePath(name, { from: resolveFrom, try: true, cache: false }))
  if (builder && missingPeers.length === 0) {
    return builder.bin
  }

  const packageManager = await detectPackageManager(rootDir) ?? defaultPackageManager
  if (!isInteractive()) {
    if (builder) {
      const { peers } = builder
      const deps = missingPeers.map(name => packageSpec(name, peers[name]))
      throw new ActionableError(`${describeMissing(command, missingPeers)} Install ${deps.length > 1 ? 'them' : 'it'} with ${formatInstallCommand(rootDir, packageManager, deps)}.`)
    }
    throw new ActionableError(`${describeMissing(command, [MODULE_BUILDER])} Install it with ${formatInstallCommand(rootDir, packageManager, [MODULE_BUILDER])}.`)
  }

  const missing = [...builder ? [] : [MODULE_BUILDER], ...missingPeers]
  const list = formatList(missing)

  logger.warn(describeMissing(command, missing))
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

  // Reuse `missingPeers` from before installing the builder so auto-installed peers
  // are still added to the module's own `devDependencies`.
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
  const controller = new AbortController()
  const spinner = createSpinner({ indicator: 'timer', onCancel: () => controller.abort() })
  spinner.start(`Installing ${list} with ${styleText('cyan', packageManager.name)}`)
  const result = await runInstall({
    cwd: rootDir,
    packageManager,
    dependencies,
    dev: true,
    onOutput: installLog.onOutput,
    onStatus: message => spinner.message(message),
    signal: controller.signal,
  })
  if (!result.success) {
    spinner.error(result.error ?? 'Install failed')
    installLog.finish(result)
    throw new ActionableError(`Could not install ${list}. Install ${dependencies.length > 1 ? 'them' : 'it'} with ${formatInstallCommand(rootDir, packageManager, dependencies)}.`)
  }
  spinner.stop(`Installed ${list}`)
  installLog.finish(result)
}

function describeMissing(command: string, missing: string[]): string {
  return `${styleText('cyan', `nuxt module ${command}`)} needs ${formatList(missing)}, which ${missing.length > 1 ? 'are' : 'is'} not installed in this module.`
}

function formatInstallCommand(rootDir: string, packageManager: DetectResult, dependencies: string[]): string {
  const { command, args } = resolveCommand(packageManager.agent, 'add', ['-D', ...dependencies])!
  const install = styleText('bold', [command, ...args].join(' '))
  return rootDir === resolve('.') ? install : `${install} in ${styleText('cyan', relativeToProcess(rootDir))}`
}

function formatList(names: string[]): string {
  const styled = names.map(name => styleText('cyan', name))
  return styled.length > 1 ? `${styled.slice(0, -1).join(', ')} and ${styled.at(-1)}` : styled[0]!
}
