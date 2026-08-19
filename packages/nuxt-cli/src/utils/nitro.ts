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

/** A Nitro package to look for, optionally through a dependency path. */
type NitroCandidate = Pick<NitroDependency, 'name'> & Partial<NitroDependency>

/**
 * The Nitro packages to look for, the one the installed Nuxt depends on first.
 *
 * The plain names are kept as later candidates so Nitro is still found when no
 * owning manifest can be read (`exports` withholding `package.json`, or Nitro
 * installed without Nuxt).
 */
function getNitroCandidates(cwd: string): NitroCandidate[] {
  const dep = resolveNuxtNitroDependency((name, via) => getPkgJSON(cwd, name, { via, strict: true }))
  const candidates: NitroCandidate[] = NITRO_PKGS.map(name => ({ name }))
  return dep ? [dep, ...candidates] : candidates
}

/** The version of the first candidate installed in the project. */
function getInstalledVersion(cwd: string, candidates: NitroCandidate[]): string {
  for (const { name, via } of candidates) {
    const version = getPkgVersion(cwd, name, via && { via, strict: true })
    if (version) {
      return version
    }
  }
  return ''
}

/** The version of Nitro the installed Nuxt depends on. */
export function getNitroVersion(cwd: string): string {
  return getInstalledVersion(cwd, getNitroCandidates(cwd))
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
  const candidates = getNitroCandidates(cwd)
  const version = getInstalledVersion(cwd, candidates)
  if (version) {
    return version
  }
  for (const { name } of candidates) {
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
