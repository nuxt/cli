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

export function getPkgVersion(cwd: string, pkg: string) {
  const pkgJSON = getPkgJSON(cwd, pkg)
  return pkgJSON?.version ?? ''
}

export function getPkgJSON(cwd: string, pkg: string) {
  for (const url of [cwd, tryResolveNuxt(cwd)]) {
    if (!url) {
      continue
    }
    const p = resolveModulePath(`${pkg}/package.json`, { from: url, try: true })
    if (p) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  }
  return null
}
