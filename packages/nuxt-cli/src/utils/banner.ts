import type { Nuxt, NuxtBuilder, NuxtConfig, NuxtOptions } from '@nuxt/schema'

import { styleText } from 'node:util'

import { logger } from './logger'
import { findNitroPkgName, NITRO_OWNERS, NITRO_PKGS } from './nitro'
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

/** The dependency path from the project to a package known to depend on Nitro. */
function nitroOwnerVia(owner: string) {
  return owner === '@nuxt/nitro-server' ? ['nuxt', owner] : [owner]
}

function getNitroVersion(cwd: string) {
  for (const owner of NITRO_OWNERS) {
    const via = nitroOwnerVia(owner)
    const name = findNitroPkgName(getPkgJSON(cwd, owner, { via: via.slice(0, -1) }))
    if (name) {
      return getPkgVersion(cwd, name, { via })
    }
  }
  // The owning manifest may be unreadable (`exports` withholding `package.json`,
  // or nitro installed without nuxt), so fall back to whatever is resolvable.
  for (const name of NITRO_PKGS) {
    const version = getPkgVersion(cwd, name)
    if (version) {
      return version
    }
  }
  return ''
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
    : parts.join('')

  logger.info(
    styleText('green', `Nuxt ${styleText('bold', nuxtVersion)}`)
    + styleText('gray', ` (with ${detail})`),
  )
}
