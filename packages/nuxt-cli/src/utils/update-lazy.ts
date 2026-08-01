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

function afterStartup(run: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Unref'd so a pending check never keeps a short command alive.
    setTimeout(() => void run().then(resolve, reject), STARTUP_GRACE_MS).unref()
  })
}
