import type { NuxtBuilder, NuxtConfig, NuxtOptions } from '@nuxt/schema'

import colors from 'picocolors'

import { logger } from './logger'
import { getPkgJSON, getPkgVersion } from './versions'

export function getBuilder(cwd: string, builder: Exclude<NuxtOptions['builder'] | NuxtConfig['builder'], NuxtBuilder>): { name: string, version: string } {
  switch (builder) {
    case 'rspack':
    case '@nuxt/rspack-builder':
      return { name: 'Rspack', version: getPkgVersion(cwd, '@rspack/core') }
    case 'webpack':
    case '@nuxt/webpack-builder':
      return { name: 'Webpack', version: getPkgVersion(cwd, 'webpack') }
    case 'vite':
    case '@nuxt/vite-builder':
    default: {
      const pkgJSON = getPkgJSON(cwd, 'vite')
      const isRolldown = pkgJSON.name.includes('rolldown')
      return { name: isRolldown ? 'Rolldown-Vite' : 'Vite', version: pkgJSON.version }
    }
  }
}

export function showVersionsFromConfig(cwd: string, config: NuxtOptions) {
  const { bold, gray, green } = colors

  const nuxtVersion = getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly') || getPkgVersion(cwd, 'nuxt3') || getPkgVersion(cwd, 'nuxt-edge')
  const nitroVersion = getPkgVersion(cwd, 'nitropack') || getPkgVersion(cwd, 'nitro') || getPkgVersion(cwd, 'nitropack-nightly') || getPkgVersion(cwd, 'nitropack-edge')
  const builder = getBuilder(cwd, config.builder)
  const vueVersion = getPkgVersion(cwd, 'vue') || null

  logger.info(
    green(`Nuxt ${bold(nuxtVersion)}`)
    + gray(' (with ')
    + (nitroVersion ? gray(`Nitro ${bold(nitroVersion)}`) : '')
    + gray(`, ${builder.name} ${bold(builder.version)}`)
    + (vueVersion ? gray(` and Vue ${bold(vueVersion)}`) : '')
    + gray(')'),
  )
}

export async function showVersions(cwd: string, kit: typeof import('@nuxt/kit')) {
  const config = await kit.loadNuxtConfig({ cwd })

  return showVersionsFromConfig(cwd, config)
}
