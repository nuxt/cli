import { colors } from 'consola/utils'
import { readPackageJSON } from 'pkg-types'

import { tryResolveNuxt } from './kit'
import { logger } from './logger'

export async function showVersions(cwd: string) {
  const { bold, gray, green } = colors
  const nuxtDir = await tryResolveNuxt(cwd)
  async function getPkgVersion(pkg: string) {
    for (const url of [cwd, nuxtDir]) {
      if (!url) {
        continue
      }
      const p = await readPackageJSON(pkg, { url }).catch(() => null)
      if (p) {
        return p.version!
      }
    }
    return ''
  }
  const nuxtVersion = await getPkgVersion('nuxt') || await getPkgVersion('nuxt-nightly') || await getPkgVersion('nuxt3') || await getPkgVersion('nuxt-edge')
  const nitroVersion = await getPkgVersion('nitropack') || await getPkgVersion('nitropack-nightly') || await getPkgVersion('nitropack-edge')

  logger.log(gray(green(`Nuxt ${bold(nuxtVersion)}`) + (nitroVersion ? ` with Nitro ${bold(nitroVersion)}` : '')))
}
