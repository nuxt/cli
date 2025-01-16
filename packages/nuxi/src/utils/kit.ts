import { createJiti } from 'jiti'

export async function loadKit(rootDir: string): Promise<typeof import('@nuxt/kit')> {
  const jiti = createJiti(rootDir)
  try {
    // Without PNP (or if users have a local install of kit, we bypass resolving from Nuxt)
    const localKit = jiti.esmResolve('@nuxt/kit', { try: true })
    // Otherwise, we resolve Nuxt _first_ as it is Nuxt's kit dependency that will be used
    const rootURL = localKit ? rootDir : (await tryResolveNuxt(rootDir)) || rootDir
    let kit: typeof import('@nuxt/kit') = await jiti.import('@nuxt/kit', { parentURL: rootURL })
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
        'nuxi requires `@nuxt/kit` to be installed in your project. Try installing `nuxt` v3 or `@nuxt/bridge` first.',
      )
    }
    throw e
  }
}

export async function tryResolveNuxt(rootDir: string) {
  const jiti = createJiti(rootDir)
  for (const pkg of ['nuxt-nightly', 'nuxt', 'nuxt3', 'nuxt-edge']) {
    const path = jiti.esmResolve(pkg, { try: true })
    if (path) {
      return path
    }
  }
  return null
}
