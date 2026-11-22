import type { ArgsDef } from 'citty'
import type { PackageJson } from 'pkg-types'

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'
import { dirname, resolve } from 'pathe'
import { x } from 'tinyexec'

import { ActionableError } from '../../utils/errors'
import { resolveRootDir } from '../../utils/paths'
import { withNodePath } from '../../utils/resolve-nuxt'
import { globalCwdArgs } from '../_shared'

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

// `args` only populate `--help` and the generated docs; `ctx.rawArgs` is forwarded as-is.
export function defineModuleBuilderCommand<T extends ArgsDef>(name: 'build' | 'prepare', description: string, args: T) {
  return defineCommand({
    meta: { name, description },
    args: {
      ...moduleRootArgs,
      ...args,
    },
    async run(ctx) {
      const bin = resolveModuleBuilderBin(resolveRootDir(ctx.args), name)
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

function resolveModuleBuilderBin(rootDir: string, command: string): string {
  const manifest = resolveModulePath('@nuxt/module-builder/package.json', {
    from: withNodePath(rootDir),
    try: true,
  })
  if (!manifest) {
    throw new ActionableError(`\`@nuxt/module-builder\` is not installed in this module. Install it as a development dependency to use \`nuxt module ${command}\`.`)
  }
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as Pick<PackageJson, 'bin'>
  const script = typeof bin === 'object'
    ? bin['nuxt-module-build']
    : undefined
  if (!script) {
    throw new ActionableError(`The installed version of \`@nuxt/module-builder\` does not support \`nuxt module ${command}\`.`)
  }
  return resolve(dirname(manifest), script)
}
