import { readPackageJSON } from 'pkg-types'
import { coerce, findMaxSatisfying } from 'verkit'

import { resolveCatalogEntry } from './catalog'
import { fetchJson } from './fetch'
import { debug } from './logger'
import { readDependencyPackageJson } from './package-json'
import { detectNpmRegistry, PUBLIC_REGISTRY } from './registry'

/** How long to wait on the registry before giving up on a version lookup. */
const FETCH_TIMEOUT = 10_000

/**
 * Names a resolved `nuxt` dependency can legitimately have, so that a
 * `package.json` reached by walking up from a resolved entry point (which happens
 * when the package exposes no `./package.json` export) is not mistaken for Nuxt's
 * own.
 */
const NUXT_PACKAGE_NAMES = new Set(['nuxt', 'nuxt-nightly'])

/** Assumed Nuxt version when the project declares no resolvable one. */
export const DEFAULT_NUXT_VERSION = '3.0.0'

export async function getNuxtVersion(cwd: string) {
  const nuxtPkg = await readDependencyPackageJson('nuxt', cwd).catch(() => null)
  if (nuxtPkg?.version && NUXT_PACKAGE_NAMES.has(nuxtPkg.name!)) {
    return nuxtPkg.version
  }
  const pkg = await readPackageJSON(cwd)
  const pkgDep = resolveCatalogEntry(cwd, pkg, 'nuxt')?.specifier
    ?? (pkg?.dependencies?.nuxt || pkg?.devDependencies?.nuxt)
  return (pkgDep && coerce(pkgDep)) || DEFAULT_NUXT_VERSION
}

/**
 * The highest published version of `pkg` matching `range`, which may be a
 * dist-tag (`latest`) or a semver range (`4`). Returns `undefined` when the
 * range matches nothing or the registry cannot be reached.
 */
export async function resolveRegistryVersion(pkg: string, range: string): Promise<string | undefined> {
  const scope = pkg.startsWith('@') ? pkg.split('/')[0]! : null
  const { registry, authorization } = await detectNpmRegistry(scope)

  const packument = await fetchPackument(pkg, registry, authorization)
    // A registry that rejects us (a proxy needing credentials this process does
    // not have) still leaves public packages readable from npm itself.
    ?? (registry === PUBLIC_REGISTRY ? undefined : await fetchPackument(pkg, PUBLIC_REGISTRY, null))
  if (!packument) {
    debug(`Failed to resolve a version of ${pkg} matching ${range}.`)
    return undefined
  }

  return packument['dist-tags']?.[range]
    // the registry lists versions in publication order, so a backported patch can
    // appear after a newer major and must not win
    ?? findMaxSatisfying(Object.keys(packument.versions ?? {}), range) ?? undefined
}

interface Packument {
  'dist-tags'?: Record<string, string>
  'versions'?: Record<string, unknown>
}

async function fetchPackument(pkg: string, registry: string, authorization: string | null): Promise<Packument | undefined> {
  try {
    return await fetchJson<Packument>(`${registry}/${pkg}`, {
      headers: {
        // The abbreviated packument is a fraction of the size of the full one and
        // still carries every version and dist-tag.
        Accept: 'application/vnd.npm.install-v1+json',
        ...authorization ? { Authorization: authorization } : {},
      },
      timeout: FETCH_TIMEOUT,
      retry: 0,
    })
  }
  catch (error) {
    debug(`Failed to read ${pkg} from ${registry}:`, error)
    return undefined
  }
}
