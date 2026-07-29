import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'
import { withNodePath } from './paths'

// `exsolve` and Node.js word their resolution failures differently
const KIT_NOT_FOUND_RE = /Cannot (?:find|resolve) module ['"]@nuxt\/kit['"]/

export async function loadKit(rootDir: string): Promise<typeof import('@nuxt/kit')> {
  try {
    const kitPath = resolveModulePath('@nuxt/kit', { from: tryResolveNuxt(rootDir) || rootDir })

    return await import(pathToFileURL(kitPath).href) as typeof import('@nuxt/kit')
  }
  catch (e: any) {
    if (KIT_NOT_FOUND_RE.test(String(e))) {
      throw new Error(
        'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3+ first.',
      )
    }
    throw e
  }
}

export function tryResolveNuxt(rootDir: string) {
  for (const pkg of ['nuxt-nightly', 'nuxt']) {
    const path = resolveModulePath(pkg, { from: withNodePath(rootDir), try: true })
    if (path) {
      return path
    }
  }
  return null
}
