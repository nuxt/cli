import { readFileSync } from 'node:fs'
import { resolveModulePath } from 'exsolve'
import { readPackageJSON } from 'pkg-types'
import { coerce } from 'semver'

import { tryResolveNuxt } from './kit'

export async function getNuxtVersion(cwd: string, cache = true) {
  const nuxtPkg = await readPackageJSON('nuxt', { url: cwd, try: true, cache })
  if (nuxtPkg) {
    return nuxtPkg.version!
  }
  const pkg = await readPackageJSON(cwd)
  const pkgDep = pkg?.dependencies?.nuxt || pkg?.devDependencies?.nuxt
  return (pkgDep && coerce(pkgDep)?.version) || '3.0.0'
}

export function getPkgVersion(cwd: string, pkg: string, options?: { via?: string }) {
  const pkgJSON = getPkgJSON(cwd, pkg, options)
  return pkgJSON?.version ?? ''
}

export function getPkgJSON(cwd: string, pkg: string, options?: { via?: string }) {
  const roots = [cwd, tryResolveNuxt(cwd)].filter((v): v is string => !!v)
  const searchFrom = [...roots]

  if (options?.via) {
    for (const from of roots) {
      const viaPath = resolveModulePath(options.via, { from, try: true })
      if (viaPath) {
        searchFrom.push(viaPath)
        break
      }
    }
  }

  for (const from of searchFrom) {
    const p = resolveModulePath(`${pkg}/package.json`, { from, try: true })
    if (p) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  }
  return null
}
