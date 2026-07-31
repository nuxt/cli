import type { SelfUpdateNudgeOptions } from './update-check'

/**
 * The update check pulls in `rc9`, `@clack/prompts`, `verkit` and the registry
 * client, and then reads `.nuxtrc` and queries the registry. Its only output is
 * rendered at process exit, so on a long-running command none of that needs to
 * compete with startup.
 */
const STARTUP_GRACE_MS = 3000

export function scheduleUpdateNudge(cwd: string, command?: string): Promise<void> {
  return afterStartup(() => import('./update').then(({ scheduleUpdateNudge }) => scheduleUpdateNudge(cwd, command)))
}

/**
 * Unlike the project check this one runs straight away, because `init` can
 * finish well inside the grace period and the nudge would be dropped with it.
 */
export function scheduleSelfUpdateNudge(name: string, current: string, options: SelfUpdateNudgeOptions): Promise<void> {
  return import('./update-check').then(({ scheduleSelfUpdateNudge }) => scheduleSelfUpdateNudge(name, current, options))
}

function afterStartup(run: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Unref'd so a pending check never keeps a short command alive.
    setTimeout(() => void run().then(resolve, reject), STARTUP_GRACE_MS).unref()
  })
}
