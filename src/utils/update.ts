import { name as pkgName, version as currentVersion } from '../../package.json'
import { $fetch } from 'ofetch'
import { cyan, green, yellow, underline } from 'colorette'
import boxen from 'boxen'
import * as semver from 'semver'

export async function checkForUpdates() {
  if (process.env.SKIP_NUXT_UPDATE_CHECK) {
    return
  }
  const { version: latestVersion = '' } = await $fetch(
    `https://registry.npmjs.org/${pkgName}/latest`
  )
  if (!latestVersion) {
    return
  }
  if (semver.gt(latestVersion, currentVersion, { loose: true })) {
    const changelogVersionHash = 'v' + latestVersion.replace(/\./g, '')
    const changelogURL = `https://github.com/nuxt/cli/blob/main/CHANGELOG.md#${changelogVersionHash}`
    console.log(
      boxen(
        `
A new version of Nuxt CLI is available: ${green(latestVersion)}
You are currently using ${yellow(currentVersion)}
Changelog: ${underline(cyan(changelogURL))}

To update: ${cyan(`npm install -g ${pkgName}`)}
      `.trim(),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          title: 'CLI Update Available',
          borderColor: 'yellow',
        }
      )
    )
  }
}
