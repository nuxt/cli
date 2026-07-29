import type { NuxtConfig } from '@nuxt/schema'

import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { consola } from 'consola'
import { resolveModulePath } from 'exsolve'

import { join } from 'pathe'

const CONFIG_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts']

/**
 * Errors that mean the config needs a loader rather than that it is broken:
 * unresolvable specifiers (`~`/`@` aliases), TypeScript that cannot be stripped
 * (`enum`, `namespace`, parameter properties), and Node versions predating
 * built-in type stripping.
 */
const LOADER_REQUIRED_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
])

export async function getNuxtConfig(rootDir: string) {
  const configFile = resolveModulePath('./nuxt.config', {
    try: true,
    from: pathToFileURL(join(rootDir, '/')).href,
    extensions: CONFIG_EXTENSIONS,
  })
  if (!configFile) {
    return {}
  }

  ;(globalThis as any).defineNuxtConfig = (c: any) => c
  try {
    try {
      return await importWithoutTypelessWarning(pathToFileURL(configFile).href)
    }
    catch (error) {
      if (!LOADER_REQUIRED_CODES.has((error as NodeJS.ErrnoException).code!)) {
        throw error
      }
      return await importConfigWithJiti(rootDir, error)
    }
  }
  catch (error) {
    consola.warn(`Failed to load \`${configFile}\`: ${(error as Error).message}`)
    return {}
  }
  finally {
    delete (globalThis as any).defineNuxtConfig
  }
}

/**
 * Node warns when it has to reparse a `.ts` file as ESM because the nearest
 * `package.json` has no `type`. Reading the config is an internal detail of
 * `nuxt info` and the warning describes our loader rather than the user's
 * project, so it is dropped for the duration of the import.
 */
async function importWithoutTypelessWarning(href: string): Promise<NuxtConfig> {
  const emitWarning = process.emitWarning
  process.emitWarning = (warning: string | Error, ...args: any[]) => {
    const code = args.find(arg => typeof arg === 'object' && arg)?.code ?? args[1]
    if (code !== 'MODULE_TYPELESS_PACKAGE_JSON') {
      (emitWarning as any)(warning, ...args)
    }
  }
  try {
    return await import(href).then(m => m.default) as NuxtConfig
  }
  finally {
    process.emitWarning = emitWarning
  }
}

/**
 * `jiti` is an optional peer dependency, so the plain import is the normal
 * path when the CLI is installed in a project. When the CLI runs from outside
 * the project (`npx nuxi`), it is instead resolved from the user's project,
 * where Nuxt provides it.
 */
async function importConfigWithJiti(rootDir: string, cause: unknown) {
  const { createJiti } = await import('jiti').catch(async () => {
    const jitiPath = resolveModulePath('jiti', {
      try: true,
      from: pathToFileURL(join(rootDir, '/')).href,
    })
    if (!jitiPath) {
      throw new Error(`${(cause as Error)?.message}. Hint: install \`jiti\` for compatibility.`, { cause })
    }
    return await import(pathToFileURL(jitiPath).href) as typeof import('jiti')
  })
  const jiti = createJiti(rootDir, {
    interopDefault: true,
    // allow using `~` and `@` in `nuxt.config`
    alias: {
      '~': rootDir,
      '@': rootDir,
    },
  })
  return await jiti.import('./nuxt.config', { default: true }) as NuxtConfig
}
