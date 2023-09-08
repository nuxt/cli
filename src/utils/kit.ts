import { importModule, tryResolveModule } from './esm'

// we are deliberately inlining this code as a backup in case user has `@nuxt/schema<3.7`
import { writeTypes as writeTypesLegacy } from '@nuxt/kit'

export const loadKit = async (
  rootDir: string,
): Promise<typeof import('@nuxt/kit')> => {
  try {
    // Without PNP (or if users have a local install of kit, we bypass resolving from nuxt)
    const localKit = await tryResolveModule('@nuxt/kit', rootDir)
    // Otherwise, we resolve Nuxt _first_ as it is Nuxt's kit dependency that will be used
    const rootURL = localKit ? rootDir : (await tryResolveNuxt()) || rootDir
    let kit: typeof import('@nuxt/kit') = await importModule(
      '@nuxt/kit',
      rootURL,
    )
    if (!kit.writeTypes) {
      // Polyfills for schema < 3.7
      kit = { ...kit, writeTypes: writeTypesLegacy }
    }
    return kit
  } catch (e: any) {
    if (e.toString().includes("Cannot find module '@nuxt/kit'")) {
      throw new Error(
        'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3 or `@nuxt/bridge` first.',
      )
    }
    throw e
  }
}

async function tryResolveNuxt() {
  for (const pkg of ['nuxt3', 'nuxt', 'nuxt-edge']) {
    const path = await tryResolveModule(pkg)
    if (path) {
      return path
    }
  }
  return null
}
