import type { NuxtUpdate } from './update-check'

import { debug } from './logger'
import { checkForUpdate, deferNudge, isUpdateCheckEnabled } from './update-check'

/**
 * Resolve the installed and latest Nuxt versions, returning nothing when the
 * project is already current or when anything at all goes wrong (an offline
 * user should never see an error from a check they did not ask for).
 */
export async function checkForNuxtUpdate(cwd: string): Promise<NuxtUpdate | undefined> {
  try {
    // imported lazily to keep package resolution off the CLI startup path
    const current = await import('./versions').then(({ getNuxtVersion }) => getNuxtVersion(cwd)).catch(() => undefined)
    return await checkForUpdate('nuxt', current)
  }
  catch (error) {
    debug('Failed to check for Nuxt updates:', error)
    return undefined
  }
}

const UNNUDGED_COMMANDS = new Set(['upgrade', 'init'])

/**
 * Check for a newer Nuxt release without blocking the command, deferring the
 * nudge to process exit so it can never interleave with the command's own
 * output (including the long-lived `dev` server's banner and logs).
 *
 * `upgrade` is excluded because the installed version is read when the command
 * starts, so a nudge would still be pending once the upgrade has succeeded.
 * `init` is excluded because the version it would report belongs to whatever
 * directory the user happened to scaffold from, not to the new project.
 */
export async function scheduleUpdateNudge(cwd: string, command?: string): Promise<void> {
  if ((command && UNNUDGED_COMMANDS.has(command)) || !isUpdateCheckEnabled()) {
    return
  }

  const update = await checkForNuxtUpdate(cwd)
  if (update) {
    deferNudge(update)
  }
}
