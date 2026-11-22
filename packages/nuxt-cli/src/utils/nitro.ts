import type { PackageJson } from 'pkg-types'
import { dirname } from 'node:path'

import { coerce, compare } from 'verkit'

import { NUXT_PACKAGES } from './nuxt-packages'
import { getNuxtPkgVersion, getPkgJSON, getPkgVersion, getProjectPkgJSON } from './pkg'
import { findPnpmWorkspaceYaml } from './workspace'

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

/** The Nitro package that provides each Nitro major. */
const NITRO_MAJOR_PKGS: Record<2 | 3, string> = { 2: 'nitropack', 3: 'nitro' }

/** The first Nuxt minor to resolve `_nitroMajor`. */
const NITRO_MAJOR_NUXT_VERSION = '4.7.0'

/** The first Nitro release whose dev server proxies HTTP/2 requests to its worker. */
const HTTP2_NITRO_VERSION = '2.13.3'

interface NitroCandidate {
  /** The name Nitro is installed under. */
  name: string
  /** The dependency path to resolve it through, when Nuxt declares it. */
  via?: string[]
}

/**
 * The Nitro packages to look for.
 *
 * Without a `nitroMajor`, the package the installed Nuxt depends on comes first,
 * with the plain names kept as later candidates so Nitro is still found when no
 * owning manifest can be read (`exports` withholding `package.json`, or Nitro
 * installed without Nuxt).
 */
function getNitroCandidates(cwd: string, nitroMajor?: 2 | 3): NitroCandidate[] {
  const declared = getNuxtNitroDependency(cwd)
  if (nitroMajor) {
    const name = NITRO_MAJOR_PKGS[nitroMajor]
    const chain = declared?.name === name
      ? [declared]
      : []
    const plain: NitroCandidate[] = [
      { name },
    ]
    // The project's own copy wins when it declares the package, but a hoisted
    // unrelated copy must not shadow the one Nuxt declares.
    return manifestDeclaresPkg(getProjectPkgJSON(cwd), name)
      ? [
          ...plain,
          ...chain,
        ]
      : [
          ...chain,
          ...plain,
        ]
  }
  const candidates: NitroCandidate[] = NITRO_PKGS.map(name => ({ name }))
  return declared
    ? [declared, ...candidates]
    : candidates
}

/** Whether a manifest declares `name` in its dependencies or devDependencies. */
function manifestDeclaresPkg(pkg: PackageJson | null, name: string): boolean {
  const { dependencies, devDependencies } = pkg ?? {}
  return name in (dependencies ?? {}) || name in (devDependencies ?? {})
}

/**
 * The Nitro major selected by the project: the project's own dependencies
 * first (`nitro` winning when both are listed), then the workspace root when
 * it declares exactly one, or `undefined` when neither does.
 */
export function getProjectNitroMajor(cwd: string): 2 | 3 | undefined {
  const major = getNitroMajorFromManifest(getProjectPkgJSON(cwd))
  if (major) {
    return major
  }

  const workspaceYaml = findPnpmWorkspaceYaml(cwd)
  const workspaceDir = workspaceYaml && dirname(workspaceYaml)
  if (!workspaceDir || workspaceDir === cwd) {
    return undefined
  }

  const { dependencies, devDependencies } = getProjectPkgJSON(workspaceDir) ?? {}
  const deps = {
    ...dependencies,
    ...devDependencies,
  }
  const hasNitro = 'nitro' in deps
  const hasNitropack = 'nitropack' in deps
  if (hasNitro === hasNitropack) {
    return undefined
  }
  return hasNitro ? 3 : 2
}

/** The Nitro major a manifest's `dependencies` and `devDependencies` select. */
function getNitroMajorFromManifest(pkg: PackageJson | null): 2 | 3 | undefined {
  const { dependencies, devDependencies } = pkg ?? {}
  const deps = {
    ...dependencies,
    ...devDependencies,
  }
  if ('nitro' in deps) {
    return 3
  }
  if ('nitropack' in deps) {
    return 2
  }
}

/** An internal `_nitroMajor` option, allowing only the values Nuxt resolves. */
export function readNitroMajor(config: unknown): 2 | 3 | undefined {
  const { _nitroMajor } = (config ?? {}) as { _nitroMajor?: unknown }
  return _nitroMajor === 2 || _nitroMajor === 3
    ? _nitroMajor
    : undefined
}

/** Whether the installed Nuxt resolves the `_nitroMajor` option. */
export function supportsNitroMajor(cwd: string): boolean {
  const version = coerce(getNuxtPkgVersion(cwd))
  return !!version && compare(version, NITRO_MAJOR_NUXT_VERSION) >= 0
}

/**
 * The Nitro major to report, from an explicit value or the project's selection
 * once the installed Nuxt resolves the `_nitroMajor` option.
 */
export function resolveNitroMajor(cwd: string, fromNuxt?: 2 | 3): 2 | 3 | undefined {
  if (fromNuxt !== undefined) {
    return fromNuxt
  }
  return supportsNitroMajor(cwd)
    ? getProjectNitroMajor(cwd)
    : undefined
}

/**
 * The Nitro package the installed Nuxt depends on, directly or through
 * `@nuxt/nitro-server`, or `undefined` when no owning manifest can be read.
 */
function getNuxtNitroDependency(cwd: string): NitroCandidate | undefined {
  const readManifest = (name: string, via?: string[]) => getPkgJSON(cwd, name, { via, strict: true })

  for (const owner of NUXT_PACKAGES) {
    const manifest = readManifest(owner)
    if (!manifest) {
      continue
    }
    const name = findNitroPkgName(manifest)
    if (name) {
      return {
        name,
        via: [owner],
      }
    }
    if (manifest.dependencies?.[NITRO_SERVER_PKG]) {
      const server = findNitroPkgName(readManifest(NITRO_SERVER_PKG, [owner]))
      if (server) {
        return {
          name: server,
          via: [owner, NITRO_SERVER_PKG],
        }
      }
    }
  }
}

/** The name of the Nitro package a manifest depends on. */
function findNitroPkgName(manifest: PackageJson | null | undefined): string | undefined {
  const deps = manifest?.dependencies
  return deps && NITRO_PKGS.find(name => name in deps)
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

/**
 * The version of Nitro the installed Nuxt depends on, or of the package
 * providing `nitroMajor` when it is given.
 */
export function getNitroVersion(cwd: string, nitroMajor?: 2 | 3): string {
  return getInstalledVersion(cwd, getNitroCandidates(cwd, nitroMajor))
}

/**
 * Whether the project's Nitro can sit behind an HTTP/2 dev server, which is
 * assumed when no Nitro version can be read.
 */
export function supportsHttp2(cwd: string): boolean {
  const version = coerce(getNitroVersion(cwd, resolveNitroMajor(cwd)))
  return !version || compare(version, HTTP2_NITRO_VERSION) >= 0
}

/**
 * The version of Nitro the installed Nuxt depends on, falling back to the
 * version `getDepVersion` reports when no Nitro package can be resolved from
 * the project (for example when it is only declared in a catalog).
 */
export async function resolveNitroVersion(
  cwd: string,
  getDepVersion: (name: string) => Promise<string | undefined>,
  nitroMajor?: 2 | 3,
): Promise<string | undefined> {
  const candidates = getNitroCandidates(cwd, nitroMajor)
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
