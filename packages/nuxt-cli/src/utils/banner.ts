import type { Nuxt, NuxtBuilder, NuxtConfig, NuxtOptions } from '@nuxt/schema'

import { styleText } from 'node:util'

import { logger } from './logger'
import { getNitroVersion } from './nitro'
import { getPkgJSON, getPkgVersion } from './pkg'

export function getBuilder(cwd: string, builder: Exclude<NuxtOptions['builder'] | NuxtConfig['builder'], NuxtBuilder>): { name: string, version: string, provider?: { name: string, version: string } } {
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
      const isRolldown = pkgJSON?.name.includes('rolldown')
      const isVitePlus = pkgJSON?.name === '@voidzero-dev/vite-plus-core'
      return {
        name: isRolldown ? 'Rolldown-Vite' : 'Vite',
        version: (isVitePlus ? pkgJSON?.bundledVersions?.vite : pkgJSON?.version) || 'unknown',
        provider: isVitePlus ? { name: 'Vite+', version: pkgJSON?.version || 'unknown' } : undefined,
      }
    }
  }
}

export function showBanner(nuxt: Nuxt) {
  const cwd = nuxt.options.rootDir

  const nuxtVersion = nuxt._version || getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly')

  const nitroVersion = getNitroVersion(cwd)
  const builder = getBuilder(cwd, nuxt.options.builder)
  const vueVersion = getPkgVersion(cwd, 'vue', { via: ['nuxt'] }) || null

  const builderPart = `${builder.name} ${styleText('bold', builder.version)}${builder.provider ? ` via ${builder.provider.name} ${styleText('bold', builder.provider.version)}` : ''}`

  const parts = [
    nitroVersion ? `Nitro ${styleText('bold', nitroVersion)}` : null,
    builderPart,
    vueVersion ? `Vue ${styleText('bold', vueVersion)}` : null,
  ].filter((part): part is string => !!part)

  const detail = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0]

  logger.info(
    styleText('green', `Nuxt ${styleText('bold', nuxtVersion)}`)
    + styleText('gray', ` (with ${detail})`),
  )
}
