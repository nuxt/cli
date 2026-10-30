import { styleText } from 'node:util'

import { confirm, isCancel } from '@clack/prompts'
import { resolveCommand } from 'package-manager-detector/commands'
import { satisfies } from 'verkit'

import { restoreRawMode, withDirectStdout } from '../../utils/console'
import { createInstallLog, runInstall, takeUnreportedIgnoredBuilds } from '../../utils/install'
import { logger } from '../../utils/logger'
import { defaultPackageManager, detectPackageManager } from '../../utils/package-managers'
import { createSpinner } from '../../utils/spinner'
import { withUserAttention } from '../../utils/startup-clock'
import { isInteractive } from '../../utils/stdout'
import { findOpenTunnelSDK, OPENTUNNEL_SDK, OPENTUNNEL_SDK_PEERS, OPENTUNNEL_SDK_RANGE, resolveProjectPackage } from './opentunnel-loader'

/**
 * Make sure the project can load the OpenTunnel SDK, offering to install it as
 * a dev dependency with the project's package manager, the way
 * `nuxt module add` installs modules. Runs before the dev server takes the
 * terminal. Returns `false` when the tunnel cannot start.
 */
export async function ensureOpenTunnelSDK(rootDir: string): Promise<boolean> {
  const state = findOpenTunnelSDK(rootDir)
  if (state.status === 'installed') {
    return true
  }

  const peers = resolveMissingPeers(rootDir)
  if (!peers) {
    return false
  }
  // An incompatible copy is replaced by the range this CLI works with.
  const dependencies = [`${OPENTUNNEL_SDK}@${OPENTUNNEL_SDK_RANGE}`, ...peers]
  const packageManager = await detectPackageManager(rootDir) ?? defaultPackageManager
  const install = resolveCommand(packageManager.agent, 'add', ['-D', ...dependencies])
  const command = install ? [install.command, ...install.args].join(' ') : `npm install -D ${dependencies.join(' ')}`
  const reason = state.status === 'incompatible'
    ? `\`--tunnel=opentunnel\` needs \`${OPENTUNNEL_SDK}@${OPENTUNNEL_SDK_RANGE}\`, and your project has ${state.version}.`
    : `\`--tunnel=opentunnel\` needs \`${OPENTUNNEL_SDK}\` in your project.`

  if (!isInteractive()) {
    logger.warn(`${reason} Run \`${command}\` to install it. Starting without a tunnel.`)
    return false
  }

  logger.info(reason)
  const answer = await withUserAttention(() => withDirectStdout(() => confirm({
    message: `Install ${dependencies.map(name => styleText('cyan', name)).join(', ')} as dev dependencies with ${styleText('cyan', packageManager.name)}?`,
    initialValue: true,
  })))
  restoreRawMode()
  if (isCancel(answer) || !answer) {
    logger.info(`Starting without a tunnel. Run \`${command}\` to install it later.`)
    return false
  }

  const controller = new AbortController()
  const installLog = createInstallLog()
  const spinner = createSpinner({ indicator: 'timer', onCancel: () => controller.abort() })
  spinner.start(`Installing with ${styleText('cyan', packageManager.name)}`)
  const result = await withUserAttention(() => runInstall({
    cwd: rootDir,
    packageManager,
    dependencies,
    dev: true,
    onOutput: installLog.onOutput,
    onStatus: message => spinner.message(message),
    signal: controller.signal,
  }))
  if (!result.success) {
    spinner.error(result.error ?? 'Install failed')
    installLog.finish(result)
    logger.info('Starting without a tunnel.')
    return false
  }
  spinner.stop(`Installed ${styleText('cyan', OPENTUNNEL_SDK)}`)
  installLog.finish(result)
  const ignoredBuilds = takeUnreportedIgnoredBuilds(result.ignoredBuilds)
  if (ignoredBuilds.length > 0 && packageManager.name === 'pnpm') {
    logger.warn(`${styleText('cyan', 'pnpm')} did not run build scripts for ${ignoredBuilds.map(name => styleText('cyan', name)).join(', ')}. Run ${styleText('cyan', 'pnpm approve-builds')} if your project needs them.`)
  }

  if (findOpenTunnelSDK(rootDir).status !== 'installed') {
    logger.warn(`\`${OPENTUNNEL_SDK}\` was installed but cannot be resolved from \`${rootDir}\`. Starting without a tunnel.`)
    return false
  }
  return true
}

/**
 * Required peers of the SDK the project does not already provide. Returns
 * `undefined` when the project has a version that conflicts: installing ours
 * would replace the one the app itself uses.
 */
function resolveMissingPeers(rootDir: string): string[] | undefined {
  const missing: string[] = []
  for (const [name, range] of Object.entries(OPENTUNNEL_SDK_PEERS)) {
    const installed = resolveProjectPackage(name, rootDir)
    if (!installed) {
      missing.push(`${name}@${range}`)
    }
    else if (!satisfies(installed.version, range)) {
      logger.warn(`\`--tunnel=opentunnel\` needs \`${name}@${range}\`, and your project uses ${installed.version || 'another version'}. Starting without a tunnel.`)
      return undefined
    }
  }
  return missing
}
