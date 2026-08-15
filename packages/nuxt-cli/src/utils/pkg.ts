import { readFileSync } from 'node:fs'
import { resolveModulePath } from 'exsolve'

import { tryResolveNuxt } from './kit'

export function getPkgVersion(cwd: string, pkg: string, options?: PkgJSONOptions) {
  const pkgJSON = getPkgJSON(cwd, pkg, options)
  return pkgJSON?.version ?? ''
}

export interface PkgJSONOptions {
  /** The dependency path to walk before resolving the package. */
  via?: string[]
  /** Resolve only through `via`, without falling back to `cwd` or `nuxt`. */
  strict?: boolean
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
 * starting from cwd. Falls back to direct resolution from cwd/nuxt,
 * unless `strict` is set, in which case only the chain is used.
 */
export function getPkgJSON(cwd: string, pkg: string, options?: PkgJSONOptions) {
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

  if (!options?.strict || !options.via?.length) {
    roots.push(cwd)
    const nuxtPath = tryResolveNuxt(cwd)
    if (nuxtPath) {
      roots.push(nuxtPath)
    }
  }

  for (const root of roots) {
    const p = resolveModulePath(`${pkg}/package.json`, { from: root, try: true })
    if (p) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  }

  return null
}
