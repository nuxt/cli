import process from 'node:process'

import { summariseActiveResources } from '../utils/hang'
import { logger } from '../utils/logger'

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
const SUPERVISOR_SHUTDOWN_TIMEOUT_MS = 15_000

/** How long a signalled process has to disappear before we give up on it. */
export const FORCE_KILL_TIMEOUT_MS = 2000

let adopted = false

/** Whether the dev command has taken interrupts over from the panel's stop-gap. */
export function isShutdownAdopted(): boolean {
  return adopted
}

/**
 * Hand interrupts to the command's own handlers.
 *
 * The panel is on screen long before the command can shut a dev server down,
 * and listening for `SIGINT` at all suppresses the default exit, so until this
 * is called the session ends the process itself.
 */
export function adoptShutdown(): void {
  adopted = true
}

const SHUTDOWN_NOTICE_MS = 1500

/**
 * Shut the dev server down on `SIGINT`/`SIGTERM`, which any listener (dev UI,
 * profiler) otherwise stops from exiting. A second Ctrl-C skips the graceful wait.
 */
export function handleShutdownSignals(close: () => Promise<void>): void {
  adoptShutdown()
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (closing) {
        process.exit(130)
      }
      closing = true

      const deadline = setTimeout(() => {
        const summary = summariseActiveResources()
        logger.warn(`The dev server did not shut down within ${SUPERVISOR_SHUTDOWN_TIMEOUT_MS / 1000}s${summary ? `: ${summary}` : ''}. Exiting anyway.`)
        process.exit()
      }, SUPERVISOR_SHUTDOWN_TIMEOUT_MS)

      void import('../utils/spinner').then(({ withSpinner }) => withSpinner('Cleaning up', async (indicator) => {
        const notice = setTimeout(() => {
          indicator.update('Cleaning up... press Ctrl-C again to exit immediately')
        }, SHUTDOWN_NOTICE_MS)
        notice.unref?.()
        try {
          await close()
        }
        catch (error) {
          console.error(error)
          process.exitCode = 1
        }
        finally {
          clearTimeout(notice)
          clearTimeout(deadline)
        }
      }, { done: 'Stopped the dev server' })).finally(() => {
        process.exit()
      })
    })
  }
}
