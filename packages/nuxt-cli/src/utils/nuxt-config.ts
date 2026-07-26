import type { NuxtConfig } from '@nuxt/schema'

import process from 'node:process'
import { pathToFileURL } from 'node:url'

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
      return await importConfigWithJiti(rootDir)
    }
  }
  catch {
    // TODO: Show error as warning if it is not 404
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
 * `jiti` is an optional peer dependency, so it is only present when the project
 * (or something in its tree) depends on it. Nuxt does, so this is the normal path
 * for configs that native `import()` cannot handle.
 */
async function importConfigWithJiti(rootDir: string) {
  const { createJiti } = await import('jiti')
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
