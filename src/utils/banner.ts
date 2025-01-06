import { colors } from 'consola/utils'
import { readPackageJSON } from 'pkg-types'
import { logger } from './logger'

export async function showVersions(cwd: string) {
  const { bold, gray, green } = colors
  async function getPkgVersion(pkg: string) {
    const p = await readPackageJSON(pkg, { url: cwd })
    return p?.version || ''
  }
  const nuxtVersion = await getPkgVersion('nuxt') || await getPkgVersion('nuxt-nightly') || await getPkgVersion('nuxt3') || await getPkgVersion('nuxt-edge')
  const nitroVersion = await getPkgVersion('nitropack') || await getPkgVersion('nitropack-nightly') || await getPkgVersion('nitropack-edge')

  logger.log(gray(green(`Nuxt ${bold(nuxtVersion)}`) + (nitroVersion ? ` with Nitro ${bold(nitroVersion)}` : '')))
}
