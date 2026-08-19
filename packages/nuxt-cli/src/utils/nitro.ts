import type { PackageJson } from 'pkg-types'

import { getPkgJSON, getPkgVersion } from './pkg'

/**
 * Names Nitro is installed under, newest naming first, so a manifest that
 * declares more than one resolves to the current name.
 *
 * Nightly releases are aliased onto these names (for example
 * `"nitropack": "npm:nitropack-nightly@latest"`), so they are not separate keys.
 */
const NITRO_PKGS = ['nitro', 'nitropack']

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

/**
 * The version of Nitro the installed Nuxt depends on.
 *
 * Falls back to any resolvable Nitro package when the owning manifest cannot be
 * read (`exports` withholding `package.json`, or Nitro installed without Nuxt).
 */
export function getNitroVersion(cwd: string): string {
  return resolveInstalledNitro(cwd).version
}

function resolveInstalledNitro(cwd: string): { name?: string, version: string } {
  const dep = resolveNuxtNitroDependency((name, via) => getPkgJSON(cwd, name, { via, strict: true }))
  const declared = dep && getPkgVersion(cwd, dep.name, { via: dep.via, strict: true })
  if (declared) {
    return { name: dep.name, version: declared }
  }
  for (const name of NITRO_PKGS) {
    const version = getPkgVersion(cwd, name)
    if (version) {
      return { name, version }
    }
  }
  return { name: dep?.name, version: '' }
}

/**
 * The version of Nitro the installed Nuxt depends on, falling back to the
 * version `getDepVersion` reports when no Nitro package can be resolved from
 * the project (for example when it is only declared in a catalog).
 */
export async function resolveNitroVersion(
  cwd: string,
  getDepVersion: (name: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const { name: owned, version } = resolveInstalledNitro(cwd)
  if (version) {
    return version
  }
  // Nuxt's own dependency is asked for first, so a stale declaration of the
  // other name cannot win when neither package is resolvable.
  const names = owned ? [owned, ...NITRO_PKGS.filter(name => name !== owned)] : NITRO_PKGS
  for (const name of names) {
    const declared = await getDepVersion(name)
    if (declared) {
      return declared
    }
  }
}

/** The name of the Nitro package a manifest depends on. */
export function findNitroPkgName(manifest: PackageJson | null | undefined): string | undefined {
  const deps = manifest?.dependencies
  return deps && NITRO_PKGS.find(name => name in deps)
}
