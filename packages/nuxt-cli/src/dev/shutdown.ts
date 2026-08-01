/**
 * How long a dev server process is given to run its `close` hooks. Nitro plugins
 * use these to close database connections and the like, so anything that signals
 * a dev server has to allow for them before escalating.
 */
export const DEV_SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * How long the process supervising a dev server waits for it to go away. Longer
 * than the budget above, since the fork spends that budget before exiting.
 */
export const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 15_000

/** How long a signalled process has to disappear before we give up on it. */
export const FORCE_KILL_TIMEOUT_MS = 2000
