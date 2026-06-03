import { readFileSync } from 'node:fs'
import { resolveModulePath } from 'exsolve'
import { readPackageJSON } from 'pkg-types'
import { coerce } from 'semver'

import { tryResolveNuxt } from './kit'

export async function getNuxtVersion(cwd: string, cache = true) {
  const nuxtPkg = await readPackageJSON('nuxt', { url: cwd, try: true, cache }).catch(() => null)
  if (nuxtPkg) {
    return nuxtPkg.version!
  }
  const pkg = await readPackageJSON(cwd)
  const pkgDep = pkg?.dependencies?.nuxt || pkg?.devDependencies?.nuxt
  return (pkgDep && coerce(pkgDep)?.version) || '3.0.0'
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
