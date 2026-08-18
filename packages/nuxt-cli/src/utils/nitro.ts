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
export const NITRO_SERVER_PKG = '@nuxt/nitro-server'

/**
 * Packages whose declared Nitro dependency is authoritative.
 *
 * Nightly releases are usually aliased onto `nuxt`, so `nuxt-nightly` only
 * covers an install under its own name.
 */
export const NUXT_PKGS = ['nuxt', 'nuxt-nightly']

/** The name of the Nitro package a manifest depends on. */
export function findNitroPkgName(manifest: PackageJson | null | undefined): string | undefined {
  const deps = manifest?.dependencies
  return deps && NITRO_DEP_NAMES.find(name => name in deps)
}
