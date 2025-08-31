import { readFileSync } from 'node:fs'

import { colors } from 'consola/utils'
import { resolveModulePath } from 'exsolve'

import { loadKit, tryResolveNuxt } from './kit'
import { logger } from './logger'

export async function showVersions(cwd: string) {
  const { bold, gray, green } = colors
  const nuxtDir = tryResolveNuxt(cwd)

  const kit = await loadKit(cwd)
  const config = await kit.loadNuxtConfig({ cwd })

  function getBuilder(): { name: string, version: string } {
    switch (config.builder) {
      case '@nuxt/rspack-builder':
        return { name: 'Rspack', version: getPkgVersion('@rspack/core') }
      case '@nuxt/webpack-builder':
        return { name: 'Webpack', version: getPkgVersion('webpack') }
      case '@nuxt/vite-builder':
      default: {
        const pkgJSON = getPkgJSON('vite')
        const isRolldown = pkgJSON.name.includes('rolldown')
        return { name: isRolldown ? 'Rolldown-Vite' : 'Vite', version: pkgJSON.version }
      }
    }
  }

  function getPkgJSON(pkg: string) {
    for (const url of [cwd, nuxtDir]) {
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

  function getPkgVersion(pkg: string) {
    const pkgJSON = getPkgJSON(pkg)
    return pkgJSON?.version ?? ''
  }

  const nuxtVersion = getPkgVersion('nuxt') || getPkgVersion('nuxt-nightly') || getPkgVersion('nuxt3') || getPkgVersion('nuxt-edge')
  const nitroVersion = getPkgVersion('nitropack') || getPkgVersion('nitropack-nightly') || getPkgVersion('nitropack-edge')
  const builder = getBuilder()
  const vueVersion = getPkgVersion('vue') || null

  logger.log(
    green(`Nuxt ${bold(nuxtVersion)}`)
    + gray(' (with: ')
    + (nitroVersion ? gray(`Nitro ${bold(nitroVersion)}`) : '')
    + gray(`, ${builder.name} ${bold(builder.version)}`)
    + (vueVersion ? gray(`, Vue ${bold(vueVersion)}`) : '')
    + gray(')'),
  )
}
