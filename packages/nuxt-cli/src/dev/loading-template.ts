import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'
import { debug } from '../utils/logger'
import { NUXT_PACKAGES } from '../utils/nuxt-packages'
import { withNodePath } from '../utils/resolve-nuxt'

export type LoadingTemplate = (data: { loading?: string }) => string

const cache = new Map<string, Promise<LoadingTemplate | undefined>>()

/**
 * The loading page Nuxt itself would render, read from the project's own
 * `nuxt/config` (falling back to `@nuxt/schema` defaults) so it matches the
 * installed Nuxt version.
 *
 * Only needed before a Nuxt instance exists, or when a project has replaced
 * `devServer.loadingTemplate` with something unusable.
 */
export function resolveDefaultLoadingTemplate(cwd: string): Promise<LoadingTemplate | undefined> {
  let template = cache.get(cwd)
  if (!template) {
    template = importDefaultLoadingTemplate(cwd)
    cache.set(cwd, template)
  }
  return template
}

async function importDefaultLoadingTemplate(cwd: string): Promise<LoadingTemplate | undefined> {
  const from = withNodePath(cwd)

  for (const pkg of NUXT_PACKAGES) {
    try {
      const configPath = resolveModulePath(`${pkg}/config`, { from, try: true })
      if (!configPath) {
        continue
      }

      const { loadingTemplate } = await import(pathToFileURL(configPath).href) as {
        loadingTemplate?: unknown
      }
      if (typeof loadingTemplate === 'function') {
        return loadingTemplate as LoadingTemplate
      }
    }
    catch (error) {
      debug(`Could not resolve the default loading template from ${pkg}/config:`, error)
    }
  }

  try {
    let nuxtPath: string | undefined
    for (const pkg of NUXT_PACKAGES) {
      nuxtPath = resolveModulePath(pkg, { from, try: true })
      if (nuxtPath) {
        break
      }
    }
    const schemaPath = resolveModulePath('@nuxt/schema', {
      from: withNodePath(nuxtPath || cwd),
      try: true,
    })
    if (!schemaPath) {
      return
    }

    // `NuxtConfigSchema` is typed as a loose `SchemaDefinition`, so the shape we rely on is asserted here
    const { NuxtConfigSchema } = await import(pathToFileURL(schemaPath).href) as {
      NuxtConfigSchema?: { devServer?: { loadingTemplate?: unknown } }
    }
    const template = NuxtConfigSchema?.devServer?.loadingTemplate

    return typeof template === 'function'
      ? template as LoadingTemplate
      : undefined
  }
  catch (error) {
    debug('Could not resolve the default loading template:', error)
  }
}
