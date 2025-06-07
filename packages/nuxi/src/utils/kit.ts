import { pathToFileURL } from 'node:url'
import { resolveModulePath } from 'exsolve'

export async function loadKit(rootDir: string): Promise<typeof import('@nuxt/kit')> {
  try {
    // Without PNP (or if users have a local install of kit, we bypass resolving from Nuxt)
    let kitPath = resolveModulePath('@nuxt/kit', { try: true, from: rootDir })
    if (!kitPath) {
      // Otherwise, we resolve Nuxt _first_ as it is Nuxt's kit dependency that will be used
      const nuxtPath = tryResolveNuxt(rootDir)
      kitPath = resolveModulePath('@nuxt/kit', { from: nuxtPath || rootDir })
    }

    let kit: typeof import('@nuxt/kit') = await import(pathToFileURL(kitPath).href)
    if (!kit.writeTypes) {
      kit = {
        ...kit,
        writeTypes: () => {
          throw new Error('`writeTypes` is not available in this version of `@nuxt/kit`. Please upgrade to v3.7 or newer.')
        },
      }
    }
    return kit
  }
  catch (e: any) {
    if (e.toString().includes('Cannot find module \'@nuxt/kit\'')) {
      throw new Error(
        'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3+ or `@nuxt/bridge` first.',
      )
    }
    throw e
  }
}

export function tryResolveNuxt(rootDir: string) {
  for (const pkg of ['nuxt-nightly', 'nuxt', 'nuxt3', 'nuxt-edge']) {
    const path = resolveModulePath(pkg, { from: rootDir, try: true })
    if (path) {
      return path
    }
  }
  return null
}
