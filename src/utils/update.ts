import { name as pkgName, version as currentVersion } from '../../package.json'
import { $fetch } from 'ofetch'
import { cyan, green, yellow, underline, gray } from 'colorette'
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
    const changelogURL = `https://github.com/nuxt/cli/releases/tag/v${latestVersion}`
    console.log(
      `
${gray('    --------------------------------------------------------------')}
    A new version of Nuxt CLI is available: ${green(latestVersion)}
    You are currently using ${yellow(currentVersion)}
    Release notes: ${underline(cyan(changelogURL))}

    To update: ${cyan(`npm install -g ${pkgName}`)}
${gray('    --------------------------------------------------------------')}
      `.trim() + '\n'
    )
  }
}
