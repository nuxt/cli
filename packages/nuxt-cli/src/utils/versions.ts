import { readFileSync } from 'node:fs'
import { resolveModulePath } from 'exsolve'
import { $fetch } from 'ofetch'
import { readPackageJSON } from 'pkg-types'
import { joinURL } from 'ufo'
import { coerce, findMaxSatisfying } from 'verkit'

import { resolveCatalogEntry } from './catalog'
import { tryResolveNuxt } from './kit'
import { debug } from './logger'
import { detectNpmRegistry } from './registry'

/** How long to wait on the registry before giving up on a version lookup. */
const FETCH_TIMEOUT = 10_000

/**
 * Names a resolved `nuxt` dependency can legitimately have, so that a
 * `package.json` reached through `pkg-types`' nearest-file fallback (which
 * happens when `nuxt` cannot be resolved at all) is not mistaken for Nuxt's own.
 */
const NUXT_PACKAGE_NAMES = new Set(['nuxt', 'nuxt-nightly', 'nuxt3', 'nuxt-edge'])

/** Assumed Nuxt version when the project declares no resolvable one. */
export const DEFAULT_NUXT_VERSION = '3.0.0'

export async function getNuxtVersion(cwd: string, cache = true) {
  const nuxtPkg = await readPackageJSON('nuxt', { url: cwd, try: true, cache }).catch(() => null)
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
  let packument: { 'dist-tags'?: Record<string, string>, 'versions'?: Record<string, unknown> }
  try {
    const scope = pkg.startsWith('@') ? pkg.split('/')[0]! : null
    const { registry, authToken } = await detectNpmRegistry(scope)

    packument = await $fetch(joinURL(registry, pkg), {
      headers: {
        // The abbreviated packument is a fraction of the size of the full one and
        // still carries every version and dist-tag.
        Accept: 'application/vnd.npm.install-v1+json',
        ...authToken ? { Authorization: `Bearer ${authToken}` } : {},
      },
      timeout: FETCH_TIMEOUT,
      retry: 0,
    })
  }
  catch (error) {
    debug(`Failed to resolve a version of ${pkg} matching ${range}:`, error)
    return undefined
  }

  return packument['dist-tags']?.[range]
    // the registry lists versions in publication order, so a backported patch can
    // appear after a newer major and must not win
    ?? findMaxSatisfying(Object.keys(packument.versions ?? {}), range) ?? undefined
}

export function getPkgVersion(cwd: string, pkg: string, options?: { via?: string[] }) {
  const pkgJSON = getPkgJSON(cwd, pkg, options)
  return pkgJSON?.version ?? ''
}

/**
 * Resolve a package.json, optionally walking a dependency chain.
 *
 * `via` is an array of `[startingPoint, ...intermediates]` describing
 * the dependency path to walk before resolving `pkg`. For example:
 *
 *   // vite is a dep of @nuxt/vite-builder, which is a dep of nuxt
 *   getPkgJSON(cwd, 'vite', { via: ['nuxt', '@nuxt/vite-builder'] })
 *
 *   // webpack is a dep of @nuxt/webpack-builder, which the user installs
 *   getPkgJSON(cwd, 'webpack', { via: ['@nuxt/webpack-builder'] })
 *
 * Each entry is resolved from the location of the previous one,
 * starting from cwd. Falls back to direct resolution from cwd/nuxt.
 */
export function getPkgJSON(cwd: string, pkg: string, options?: { via?: string[] }) {
  // Build list of locations to try resolving pkg from.
  // When `via` is provided, walk the chain first; then fall back to cwd/nuxt.
  const roots: string[] = []

  if (options?.via && options.via.length > 0) {
    let from: string | undefined = cwd
    for (const step of options.via) {
      from = resolveModulePath(step, { from, try: true }) ?? undefined
      if (!from) {
        break
      }
    }
    if (from) {
      roots.push(from)
    }
  }

  // Fallback: direct resolution from cwd or nuxt's location
  roots.push(cwd)
  const nuxtPath = tryResolveNuxt(cwd)
  if (nuxtPath) {
    roots.push(nuxtPath)
  }

  for (const root of roots) {
    const p = resolveModulePath(`${pkg}/package.json`, { from: root, try: true })
    if (p) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  }

  return null
}
