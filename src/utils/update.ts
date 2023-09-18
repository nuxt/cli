import nuxiPkg from '../../package.json'
import { $fetch } from 'ofetch'
import { cyan, green, yellow, underline } from 'colorette'
import consola from 'consola'
import * as semver from 'semver'

export async function checkForUpdates() {
  if (process.env.SKIP_NUXT_UPDATE_CHECK) {
    return
  }
  const { version: latestVersion = '' } = await $fetch(
    `https://registry.npmjs.org/${nuxiPkg.name}/latest`,
  )
  if (!latestVersion) {
    return
  }
  if (semver.gt(latestVersion, nuxiPkg.version, { loose: true })) {
    const changelogURL = `https://github.com/nuxt/cli/releases/tag/v${latestVersion}`
    consola.box({
      title: 'Nuxt CLI Update is Available!',
      style: {
        borderColor: 'green',
      },
      message: [
        `A new version of Nuxt CLI is available: ${green(latestVersion)}`,
        `You are currently using ${yellow(nuxiPkg.version)}`,
        '',
        `Release notes: ${underline(cyan(changelogURL))}`,
        '',
        `To update: \`npm install -g ${nuxiPkg.name}\``,
      ].join('\n'),
    })
  }
}
