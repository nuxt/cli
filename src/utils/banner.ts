import { bold, gray, green } from 'colorette'
import { tryRequireModule } from './cjs'

export function showVersions(cwd: string) {
  const getPkgVersion = (pkg: string) => {
    return tryRequireModule(`${pkg}/package.json`, cwd)?.version || ''
  }
  const nuxtVersion = getPkgVersion('nuxt') || getPkgVersion('nuxt-edge')
  const nitroVersion = getPkgVersion('nitropack')
  console.log(
    gray(
      green(`Nuxt ${bold(nuxtVersion)}`) +
        (nitroVersion ? ` with Nitro ${bold(nitroVersion)}` : ''),
    ),
  )
}
