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
  logger.info(describeStack(nuxt.options.rootDir, { nuxtVersion: nuxt._version, builder: nuxt.options.builder }))
}

export interface StackVersions {
  nuxt: string
  nitro: string
  builder: { name: string, version: string, provider?: { name: string, version: string } }
  vue: string | null
}

/** The versions of the framework packages in use, for the banner and the dev UI. */
export function resolveStackVersions(cwd: string, options: { nuxtVersion?: string, builder?: NuxtOptions['builder'] | NuxtConfig['builder'] } = {}): StackVersions {
  return {
    nuxt: options.nuxtVersion || getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly'),
    nitro: getNitroVersion(cwd),
    builder: getBuilder(cwd, options.builder as Exclude<NuxtOptions['builder'], NuxtBuilder>),
    vue: getPkgVersion(cwd, 'vue', { via: ['nuxt'] }) || null,
  }
}

/** The `Nuxt x (with Nitro y, Vite z and Vue w)` line shown at startup. */
function describeStack(cwd: string, options: { nuxtVersion?: string, builder?: NuxtOptions['builder'] | NuxtConfig['builder'] } = {}): string {
  const { nuxt: nuxtVersion, nitro: nitroVersion, builder, vue: vueVersion } = resolveStackVersions(cwd, options)

  const builderPart = `${builder.name} ${styleText('bold', builder.version)}${builder.provider ? ` via ${builder.provider.name} ${styleText('bold', builder.provider.version)}` : ''}`

  const parts = [
    nitroVersion ? `Nitro ${styleText('bold', nitroVersion)}` : null,
    builderPart,
    vueVersion ? `Vue ${styleText('bold', vueVersion)}` : null,
  ].filter((part): part is string => !!part)

  const detail = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0]

  return (
    styleText('green', `Nuxt ${styleText('bold', nuxtVersion)}`)
    + styleText('gray', ` (with ${detail})`)
  )
}
