import type { NuxtBuilder, NuxtConfig, NuxtOptions } from '@nuxt/schema'

import { colors } from 'consola/utils'

import { logger } from './logger'
import { getPkgJSON, getPkgVersion } from './versions'

export function getBuilder(cwd: string, builder: Exclude<NuxtOptions['builder'] | NuxtConfig['builder'], NuxtBuilder>): { name: string, version: string } {
  switch (builder) {
    case 'rspack':
    case '@nuxt/rspack-builder':
      return { name: 'Rspack', version: getPkgVersion(cwd, '@rspack/core', { via: ['@nuxt/rspack-builder'] }) }
    case 'webpack':
    case '@nuxt/webpack-builder':
      return { name: 'Webpack', version: getPkgVersion(cwd, 'webpack', { via: ['@nuxt/webpack-builder'] }) }
    case 'vite':
    case '@nuxt/vite-builder':
    default: {
      const pkgJSON = getPkgJSON(cwd, 'vite', { via: ['nuxt', '@nuxt/vite-builder'] })
      const isRolldown = pkgJSON.name.includes('rolldown')
      return { name: isRolldown ? 'Rolldown-Vite' : 'Vite', version: pkgJSON.version || 'unknown' }
    }
  }
}

export function showVersionsFromConfig(cwd: string, config: NuxtOptions) {
  const { bold, gray, green } = colors

  const nuxtVersion = getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly') || getPkgVersion(cwd, 'nuxt3') || getPkgVersion(cwd, 'nuxt-edge')
  const nitroVia = { via: ['nuxt', '@nuxt/nitro-server'] }
  const nitroVersion = getPkgVersion(cwd, 'nitropack', nitroVia) || getPkgVersion(cwd, 'nitro', nitroVia) || getPkgVersion(cwd, 'nitropack-nightly') || getPkgVersion(cwd, 'nitropack-edge')
  const builder = getBuilder(cwd, config.builder)
  const vueVersion = getPkgVersion(cwd, 'vue', { via: ['nuxt'] }) || null

  logger.info(
    green(`Nuxt ${bold(nuxtVersion)}`)
    + gray(' (with ')
    + (nitroVersion ? gray(`Nitro ${bold(nitroVersion)}`) : '')
    + gray(`, ${builder.name} ${bold(builder.version)}`)
    + (vueVersion ? gray(` and Vue ${bold(vueVersion)}`) : '')
    + gray(')'),
  )
}

export async function showVersions(cwd: string, kit: typeof import('@nuxt/kit'), dotenv?: string) {
  const config = await kit.loadNuxtConfig({
    cwd,
    dotenv: dotenv ? { cwd, fileName: dotenv } : undefined,
  })

  return showVersionsFromConfig(cwd, config)
}
