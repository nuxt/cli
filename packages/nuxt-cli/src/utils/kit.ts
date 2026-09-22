import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'
import { ActionableError } from './errors'
import { tryResolveNuxt } from './resolve-nuxt'

// `exsolve` and Node.js word their resolution failures differently
const KIT_NOT_FOUND_RE = /Cannot (?:find|resolve) module ['"]@nuxt\/kit['"]/

export async function loadKit(rootDir: string): Promise<typeof import('@nuxt/kit')> {
  try {
    const kitPath = resolveModulePath('@nuxt/kit', { from: tryResolveNuxt(rootDir) || rootDir })

    return await import(pathToFileURL(kitPath).href) as typeof import('@nuxt/kit')
  }
  catch (e: any) {
    if (KIT_NOT_FOUND_RE.test(String(e))) {
      throw new ActionableError(
        'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3+ first.',
      )
    }
    throw e
  }
}
