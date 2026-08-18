import type { PackageJson } from 'pkg-types'

/**
 * Dependency names Nitro is declared under, newest naming first, so a manifest
 * that declares more than one resolves to the current name.
 *
 * Nightly and edge releases are aliased onto these names (for example
 * `"nitro": "npm:nitro-nightly@latest"`), so they are not separate keys.
 */
const NITRO_DEP_NAMES = ['nitro', 'nitropack']

/**
 * Names Nitro is resolvable under when it cannot be found through Nuxt,
 * including the aliased releases in case one is installed directly.
 */
export const NITRO_PKGS = [...NITRO_DEP_NAMES, 'nitro-nightly', 'nitropack-nightly', 'nitropack-edge']

/**
 * The package that declares Nitro in Nuxt versions where `nuxt` itself does
 * not. Only consulted when the installed Nuxt declares it as a dependency, so
 * a copy installed outside the Nuxt dependency chain cannot shadow the Nitro
 * version Nuxt actually uses.
 */
const NITRO_SERVER_PKG = '@nuxt/nitro-server'

/**
 * Packages whose declared Nitro dependency is authoritative.
 *
 * Nightly releases are usually aliased onto `nuxt`, so `nuxt-nightly` only
 * covers an install under its own name.
 */
const NUXT_PKGS = ['nuxt', 'nuxt-nightly']

export interface NitroDependency {
  /** The Nitro package name the installed Nuxt declares. */
  name: string
  /** The dependency path from the project to the package declaring it. */
  via: string[]
}

/**
 * The Nitro package the installed Nuxt depends on, directly or through
 * `@nuxt/nitro-server`, or `undefined` when no owning manifest can be read.
 */
export function resolveNuxtNitroDependency(
  readManifest: (name: string, via?: string[]) => PackageJson | null | undefined,
): NitroDependency | undefined {
  for (const owner of NUXT_PKGS) {
    const manifest = readManifest(owner)
    if (!manifest) {
      continue
    }
    const name = findNitroPkgName(manifest)
    if (name) {
      return { name, via: [owner] }
    }
    if (manifest.dependencies?.[NITRO_SERVER_PKG]) {
      const serverName = findNitroPkgName(readManifest(NITRO_SERVER_PKG, [owner]))
      if (serverName) {
        return { name: serverName, via: [owner, NITRO_SERVER_PKG] }
      }
    }
  }
}

/** The name of the Nitro package a manifest depends on. */
export function findNitroPkgName(manifest: PackageJson | null | undefined): string | undefined {
  const deps = manifest?.dependencies
  return deps && NITRO_DEP_NAMES.find(name => name in deps)
}
