import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { resolveModulePath } from 'exsolve'
import { dirname, extname, join, normalize } from 'pathe'

export interface UpdateConfigOptions {
  /** The project root directory. */
  cwd: string
  /** Config file basename without extension (e.g. `nuxt.config`). */
  configFile: string
  /** Extension used when creating a missing config file. */
  createExtension?: string
  /** Called when no config file exists. Return `false` to abort, or a string to seed the new file. */
  onCreate?: (ctx: { configFile: string }) => boolean | string | void | Promise<boolean | string | void>
  /** Called with the parsed config object, which can be mutated in place. */
  onUpdate?: (config: any) => void | Promise<void>
}

export interface UpdateConfigResult {
  configFile: string
  created: boolean
}

const RESOLVE_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml']
const UPDATABLE_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts']

/**
 * Update a config file in place (preserving formatting and comments), creating
 * it first if it does not exist.
 */
export async function updateConfig(options: UpdateConfigOptions): Promise<UpdateConfigResult> {
  let configFile = tryResolve(`./${options.configFile}`, options.cwd)
    || tryResolve(`./.config/${options.configFile}`, options.cwd)
    || tryResolve(`./.config/${options.configFile.split('.')[0]}`, options.cwd)

  let created = false
  if (!configFile) {
    configFile = join(options.cwd, options.configFile + (options.createExtension || '.ts'))
    const createResult = await options.onCreate?.({ configFile }) ?? true
    if (!createResult) {
      throw new Error('Config file creation aborted.')
    }
    const contents = typeof createResult === 'string' ? createResult : 'export default {}\n'
    await mkdir(dirname(configFile), { recursive: true })
    await writeFile(configFile, contents, 'utf8')
    created = true
  }

  const ext = extname(configFile)
  if (!UPDATABLE_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported config file extension: ${ext} (${configFile}) (supported: ${UPDATABLE_EXTENSIONS.join(', ')})`)
  }

  const { parseModule } = await import('magicast')
  const mod = parseModule(await readFile(configFile, 'utf8'))

  const defaultExport = mod.exports.default
  if (!defaultExport) {
    throw new Error('Default export is missing in the config file!')
  }

  // `export default defineNuxtConfig({ ... })` wraps the config we want to update.
  const config = defaultExport.$type === 'function-call' ? defaultExport.$args[0] : defaultExport

  await options.onUpdate?.(config)

  await writeFile(configFile, mod.generate().code, 'utf8')

  return { configFile, created }
}

function tryResolve(path: string, cwd: string) {
  const resolved = resolveModulePath(path, {
    try: true,
    from: join(cwd, '/'),
    extensions: RESOLVE_EXTENSIONS,
    suffixes: ['', '/index'],
    cache: false,
  })
  return resolved ? normalize(resolved) : undefined
}
